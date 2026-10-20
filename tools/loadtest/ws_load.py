"""WebSocket load test for the price backend. No extra dependencies: uses the backend venv (websockets, redis).

Two scenarios:

  capacity   N clients connect and subscribe; measures connect success and delivery latency of normal traffic.
             python tools/loadtest/ws_load.py capacity --clients 1000 --seconds 20 --ramp 100

  slow       F fast clients + S SLOW clients (they stop reading) while the tool floods one symbol with
             padded ticks via Redis. Shows whether slow clients delay everyone else (Backlog #21).
             python tools/loadtest/ws_load.py slow --fast 50 --slow 5 --rate 200 --seconds 20

Latency = time the client received a tick − time it was published (flood) or sent by our server (normal ticks).
Client and server run on the same machine here, so they share a clock and the number is exact.
Run from the repo root with the backend venv's python, while the backend (and Redis) are running.
"""

import argparse
import asyncio
import json
import os
import socket
import statistics
import subprocess
import time
from dataclasses import dataclass, field

import redis.asyncio as aioredis
from websockets.asyncio.client import connect

URL = os.getenv("WS_URL", "ws://127.0.0.1:8000/api/ws/prices")
REDIS = os.getenv("REDIS_URL", "redis://localhost:6379/0")
FLOOD_SYMBOL = "LTIM"  # a simulated stock; the flood only PUBLISHes, it never overwrites stored prices


def pct(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    return s[min(len(s) - 1, max(0, int(round(p * len(s) + 0.5)) - 1))]


def backend_memory_mb() -> float | None:
    """Working-set memory of whatever listens on :8000 (Windows only; None elsewhere)."""
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
        pid = next(l.split()[-1] for l in out.splitlines() if ":8000 " in l and "LISTENING" in l)
        csv = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout
        return int(csv.split('","')[4].replace(" K", "").replace(",", "").replace('"', "").strip()) / 1024
    except Exception:  # noqa: BLE001 — best effort
        return None


@dataclass
class Client:
    latencies: list[float] = field(default_factory=list)
    received: int = 0
    connected: bool = False
    error: str | None = None


async def run_client(c: Client, symbols: list[str], stop: asyncio.Event, slow: bool = False) -> None:
    try:
        sock = None
        if slow:
            # A slow client (e.g. a phone on bad mobile data): tiny receive buffer, and it never reads.
            sock = socket.create_connection(("127.0.0.1", 8000))
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
        async with connect(URL, sock=sock, max_queue=1 if slow else 64, open_timeout=30) as ws:
            c.connected = True
            await ws.send(json.dumps({"type": "subscribe", "symbols": symbols}))
            if slow:
                await stop.wait()  # never read: the server's send buffer for this client fills up
                return
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "tick" and "tx" in msg:
                    # Flood ticks: measure from the moment they were PUBLISHED (includes any queueing in
                    # Redis or the hub). Normal ticks: from the moment our server sent them.
                    start = msg["ts"] if "pad" in msg else msg["tx"]
                    c.latencies.append(time.time() * 1000 - start)
                    c.received += 1
    except Exception as exc:  # noqa: BLE001 — connection refused/closed counts as a failed client
        c.error = f"{type(exc).__name__}: {str(exc)[:80]}"
        return


async def flood(rate: int, stop: asyncio.Event, sent: list[int]) -> None:
    r = aioredis.Redis.from_url(REDIS)
    pad = "x" * 1000  # ~1 KB per message, so buffers fill in seconds instead of hours
    interval = 1 / rate
    nxt = time.perf_counter()
    while not stop.is_set():
        now = int(time.time() * 1000)
        await r.publish(f"prices:{FLOOD_SYMBOL}", json.dumps(
            {"symbol": FLOOD_SYMBOL, "price": 5800.0, "open": 5800.0, "ts": now, "rx": now, "pad": pad}))
        sent[0] += 1
        nxt += interval
        await asyncio.sleep(max(0, nxt - time.perf_counter()))
    await r.aclose()


def report(title: str, clients: list[Client], extra: str = "") -> float:
    """Prints the results and returns p95 (ms)."""
    lat = [x for c in clients for x in c.latencies]
    ok = sum(c.connected for c in clients)
    print(f"\n== {title} ==")
    print(f"connected {ok}/{len(clients)}   ticks received {sum(c.received for c in clients):,}   {extra}")
    errors: dict[str, int] = {}
    for c in clients:
        if c.error and not c.connected:
            errors[c.error] = errors.get(c.error, 0) + 1
    for err, n in sorted(errors.items(), key=lambda e: -e[1])[:3]:
        print(f"  failed to connect ×{n}: {err}")
    print(f"latency ms  p50 {pct(lat, .5):8.1f}   p95 {pct(lat, .95):8.1f}   p99 {pct(lat, .99):8.1f}"
          f"   max {max(lat, default=float('nan')):8.1f}" + (f"   mean {statistics.fmean(lat):.1f}" if lat else ""))
    return pct(lat, .95)


async def capacity(args) -> None:
    stop = asyncio.Event()
    clients = [Client() for _ in range(args.clients)]
    mem_before = backend_memory_mb()
    tasks = []
    for c in clients:  # users arrive at --ramp per second (all at once = a reconnect storm)
        tasks.append(asyncio.create_task(run_client(c, ["BTC", "ETH", "TCS", "INFY", "RELIANCE"], stop)))
        await asyncio.sleep(1 / args.ramp)
    await asyncio.sleep(args.seconds)
    mem_after = backend_memory_mb()
    stop.set()
    await asyncio.gather(*tasks)
    mem = ""
    if mem_before and mem_after:
        mem = f"backend memory {mem_before:.0f} → {mem_after:.0f} MB (~{(mem_after - mem_before) * 1024 / max(1, args.clients):.0f} KB per client)"
    report(f"capacity: {args.clients} clients arriving at {args.ramp:.0f}/s, {args.seconds}s", clients, mem)


async def slow(args) -> None:
    stop = asyncio.Event()
    fast = [Client() for _ in range(args.fast)]
    slow_clients = [Client() for _ in range(args.slow)]
    tasks = [asyncio.create_task(run_client(c, [FLOOD_SYMBOL], stop)) for c in fast]
    tasks += [asyncio.create_task(run_client(c, [FLOOD_SYMBOL], stop, slow=True)) for c in slow_clients]
    await asyncio.sleep(2)  # everyone connected and subscribed
    sent = [0]
    flood_task = asyncio.create_task(flood(args.rate, stop, sent))
    await asyncio.sleep(args.seconds)
    stop.set()
    await asyncio.gather(flood_task, *tasks)
    expected = sent[0] * args.fast
    got = sum(c.received for c in fast)
    p95 = report(f"slow-client test: {args.fast} fast + {args.slow} slow clients, {args.rate} msg/s for {args.seconds}s",
                 fast, f"(fast clients got {got:,} of {expected:,} = {100 * got / max(1, expected):.0f} %)")
    # Performance budget (used by CI): fail if healthy clients got slower than allowed, or got nothing.
    if args.max_p95 is not None and not (p95 <= args.max_p95):
        raise SystemExit(f"FAIL: p95 {p95:.1f} ms is over the budget of {args.max_p95:.0f} ms")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capacity")
    c.add_argument("--clients", type=int, default=500)
    c.add_argument("--seconds", type=int, default=20)
    c.add_argument("--ramp", type=float, default=100, help="new connections per second")
    s = sub.add_parser("slow")
    s.add_argument("--fast", type=int, default=50)
    s.add_argument("--slow", type=int, default=5)
    s.add_argument("--rate", type=int, default=200)
    s.add_argument("--seconds", type=int, default=20)
    s.add_argument("--max-p95", type=float, default=None, help="exit with an error if p95 (ms) is above this")
    args = p.parse_args()
    asyncio.run(capacity(args) if args.cmd == "capacity" else slow(args))


if __name__ == "__main__":
    main()
