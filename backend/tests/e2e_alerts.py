"""End-to-end check of server-side alerts against a RUNNING backend (with Redis).

Run from backend/ with the venv active, while the backend is running:
    python tests/e2e_alerts.py                  # default http://127.0.0.1:8000, redis://localhost:6379
    BACKEND_URL=http://127.0.0.1:8000 REDIS_URL=redis://localhost:6379/0 python tests/e2e_alerts.py
Exits with code 1 if any check fails (so CI can use it).
"""
import asyncio
import json
import os
import sys
import time
import urllib.error
import urllib.request

from websockets.asyncio.client import connect

B = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
REDIS = os.getenv("REDIS_URL", "redis://localhost:6379/0")
WS = B.replace("http", "ws", 1) + "/api/ws/prices"
ok = fail = 0


def check(name, cond, detail=""):
    global ok, fail
    print(("PASS " if cond else "FAIL ") + name + (f"   ({detail})" if detail and not cond else ""))
    ok, fail = ok + bool(cond), fail + (not cond)


def call(method, path, body=None, token=None):
    req = urllib.request.Request(B + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def login(email):
    call("POST", "/api/auth/register", {"email": email, "password": "supersecret1"})
    return call("POST", "/api/auth/login", {"email": email, "password": "supersecret1"})[1]["access_token"]


def price(symbol):
    import redis  # installed in the backend venv
    r = redis.Redis.from_url(REDIS, decode_responses=True)
    while True:
        last = r.get(f"price:last:{symbol}")
        if last:
            return json.loads(last)["price"]
        time.sleep(1)


async def main():
    tok = login(f"alerts{int(time.time())}@example.com")
    other = login(f"other{int(time.time())}@example.com")

    st, _ = call("GET", "/api/alerts")
    check("list without login → 401", st == 401)

    sym = "TCS"  # simulated stock: moves ±0.4 % every 1.5 s
    p = price(sym)
    st, body = call("POST", "/api/alerts", {"symbol": sym, "direction": "above", "target_price": p * 0.9}, tok)
    check("'above' a price already below current → 422 would_trigger_immediately", st == 422 and body["detail"] == "would_trigger_immediately", body)
    st, body = call("POST", "/api/alerts", {"symbol": "NOPE", "direction": "above", "target_price": 1}, tok)
    check("unknown symbol → 422", st == 422, body)

    # Alert A: fires while NO socket is connected (the old browser-only design would miss it)
    st, a = call("POST", "/api/alerts", {"symbol": sym, "direction": "above", "target_price": round(p * 1.0005, 2)}, tok)
    check("create alert → 201", st == 201 and a["status"] == "active", (st, a))
    st, b = call("POST", "/api/alerts", {"symbol": sym, "direction": "below", "target_price": round(p * 0.5, 2)}, tok)
    st, _ = call("DELETE", f"/api/alerts/{b['id']}", token=other)
    check("other user can't cancel my alert → 404", st == 404)
    st, _ = call("DELETE", f"/api/alerts/{b['id']}", token=tok)
    check("cancel own alert → 204", st == 204)

    deadline = time.time() + 40
    status_a = "active"
    while time.time() < deadline and status_a == "active":
        await asyncio.sleep(1.5)
        lst = call("GET", "/api/alerts", token=tok)[1]
        status_a = next((x["status"] for x in lst if x["id"] == a["id"]), "missing")
    lst = call("GET", "/api/alerts", token=tok)[1]
    fired = next((x for x in lst if x["id"] == a["id"]), None)
    check("alert fired with no browser open (status triggered, price saved)",
          fired and fired["status"] == "triggered" and fired["triggered_price"] >= a["target_price"], fired)
    check("cancelled alert not listed", all(x["id"] != b["id"] for x in lst))

    # Alert C: delivered live over an authenticated WebSocket; other user's socket must NOT get it
    p = price(sym)
    async with connect(WS) as mine, connect(WS) as theirs:
        await mine.send(json.dumps({"type": "auth", "token": tok}))
        await theirs.send(json.dumps({"type": "auth", "token": other}))
        r1 = json.loads(await mine.recv())
        json.loads(await theirs.recv())
        check("socket auth with valid token → ok", r1 == {"type": "auth_result", "ok": True}, r1)
        st, c = call("POST", "/api/alerts", {"symbol": sym, "direction": "above", "target_price": round(p * 1.0005, 2)}, tok)
        await asyncio.sleep(0.5)  # let the engine reload its index
        import redis
        r = redis.Redis.from_url(REDIS, decode_responses=True)
        r.publish(f"prices:{sym}", json.dumps({"symbol": sym, "price": round(p * 1.01, 2), "open": p, "ts": int(time.time() * 1000)}))
        got = None
        try:
            async with asyncio.timeout(45):
                async for raw in mine:
                    m = json.loads(raw)
                    if m["type"] == "alert":
                        got = m
                        break
        except TimeoutError:
            pass
        check("fired alert pushed to my socket", got is not None and got["id"] == c["id"], got)
        leaked = False
        try:
            async with asyncio.timeout(2):
                async for raw in theirs:
                    if json.loads(raw)["type"] == "alert":
                        leaked = True
                        break
        except TimeoutError:
            pass
        check("other user's socket did not receive it", not leaked)

    async with connect(WS) as bad:
        await bad.send(json.dumps({"type": "auth", "token": "not-a-jwt"}))
        r = json.loads(await bad.recv())
        check("socket auth with bad token → ok:false", r == {"type": "auth_result", "ok": False}, r)

    # Exactly-once: two engines racing to fire the same alert → only one wins
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app.realtime.alerts_engine import _mark_triggered
    st, d = call("POST", "/api/alerts", {"symbol": sym, "direction": "below", "target_price": round(price(sym) * 0.5, 2)}, tok)
    results = await asyncio.gather(*(asyncio.to_thread(_mark_triggered, d["id"], 1.0) for _ in range(5)))
    check("5 concurrent fire attempts → exactly 1 succeeds", sum(results) == 1, results)

    print(f"\n{ok} passed, {fail} failed")


asyncio.run(main())
