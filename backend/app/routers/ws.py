"""Browser-facing WebSocket.

Protocol (JSON):
  client → server  {"type": "subscribe",   "symbols": ["BTC", "TCS"]}
                   {"type": "unsubscribe", "symbols": ["BTC"]}
                   {"type": "auth", "token": "<access token>" | null}   (optional: for private alerts)
                   {"type": "ping", "t0": <browser ms>}                 (clock sync for latency tracing)
  server → client  {"type": "snapshot", "symbol", "price", "open", "ts", "history": [[ts, price], …]}
                   {"type": "tick",     "symbol", "price", "open", "ts", "rx", "tx"}
                     ts = exchange time, rx = received by us, tx = sent by us (all epoch ms)
                   {"type": "pong", "t0", "server"}
                   {"type": "auth_result", "ok": true | false}
                   {"type": "alert", "id", "symbol", "direction", "target_price", "triggered_price", "triggered_at"}
Prices are public market data, so the socket works without login (Decision Log). Logging in on the
socket only adds private messages (your fired alerts). The token goes in a message, not the URL,
because URLs end up in server and proxy logs.
"""

import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from ..deps import user_id_from_token
from ..realtime.broker import PriceBroker
from ..realtime.hub import ConnectionHub
from ..realtime.stats import stats
from ..symbols import ALL_SYMBOLS

router = APIRouter()
log = logging.getLogger("ws")

MAX_SYMBOLS_PER_CLIENT = 50


@router.websocket("/api/ws/prices")
async def prices_socket(ws: WebSocket) -> None:
    hub: ConnectionHub = ws.app.state.hub
    broker: PriceBroker = ws.app.state.broker
    subscribed: set[str] = set()

    await ws.accept()
    client = hub.connect(ws)  # all our messages to this browser go through its outbox
    stats.ws_clients += 1
    try:
        while True:
            msg = await ws.receive_json()
            symbols = [s for s in msg.get("symbols", []) if isinstance(s, str) and s in ALL_SYMBOLS]
            if msg.get("type") == "subscribe":
                for symbol in symbols:
                    if symbol in subscribed or len(subscribed) >= MAX_SYMBOLS_PER_CLIENT:
                        continue
                    subscribed.add(symbol)
                    hub.add(ws, symbol)  # register first, so no tick is missed between the two steps
                    snapshot = await broker.snapshot(symbol)
                    if snapshot:
                        client.push(snapshot)
            elif msg.get("type") == "unsubscribe":
                for symbol in symbols:
                    subscribed.discard(symbol)
                    hub.remove(ws, symbol)
            elif msg.get("type") == "ping":
                # Clock sync for latency tracing: the browser compares our clock with its own.
                client.push({"type": "pong", "t0": msg.get("t0"), "server": int(time.time() * 1000)})
            elif msg.get("type") == "auth":
                token = msg.get("token")
                # Token check touches the DB (session revoked?), so it runs in a worker thread.
                user_id = await run_in_threadpool(user_id_from_token, token) if isinstance(token, str) else None
                hub.set_user(ws, user_id)
                client.push({"type": "auth_result", "ok": user_id is not None})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — bad JSON etc.: drop this client only
        log.info("closing client: %r", exc)
        try:
            await ws.close(code=1003)
        except RuntimeError:
            pass  # socket already closed
    finally:
        hub.disconnect(ws)
        stats.ws_clients -= 1
