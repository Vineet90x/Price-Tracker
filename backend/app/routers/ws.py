"""Browser-facing WebSocket.

Protocol (JSON):
  client → server  {"type": "subscribe",   "symbols": ["BTC", "TCS"]}
                   {"type": "unsubscribe", "symbols": ["BTC"]}
  server → client  {"type": "snapshot", "symbol", "price", "open", "ts", "history": [[ts, price], …]}
                   {"type": "tick",     "symbol", "price", "open", "ts"}
Prices are public market data, so the socket needs no login (Decision Log).
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
                        await ws.send_json(snapshot)
            elif msg.get("type") == "unsubscribe":
                for symbol in symbols:
                    subscribed.discard(symbol)
                    hub.remove(ws, symbol)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — bad JSON etc.: drop this client only
        log.info("closing client: %r", exc)
        try:
            await ws.close(code=1003)
        except RuntimeError:
            pass  # socket already closed
    finally:
        hub.remove_all(ws)
        stats.ws_clients -= 1
