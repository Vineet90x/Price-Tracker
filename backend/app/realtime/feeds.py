"""Producers. Each one runs ONCE per backend process, independent of how many clients are connected."""

import asyncio
import json
import logging
import random
import time
from collections.abc import Awaitable, Callable

from websockets.asyncio.client import connect

from ..config import settings
from ..symbols import CRYPTO, SIMULATED_STOCKS
from .broker import PriceBroker
from .stats import stats

log = logging.getLogger("feeds")


async def run_forever(name: str, task: Callable[[], Awaitable[None]]) -> None:
    """Restart a crashed background task with exponential backoff (1 s, 2 s, 4 s … max 30 s).
    Covers both a dropped Binance socket and Redis being briefly unavailable."""
    backoff = 1.0
    while True:
        started = time.monotonic()
        try:
            await task()
            log.warning("%s stopped; restarting", name)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — any failure should restart, not kill the task
            log.warning("%s failed: %r", name, exc)
        if time.monotonic() - started > 60:
            backoff = 1.0  # it ran fine for a while; this is a fresh failure
        log.info("%s retry in %.0fs", name, backoff)
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30.0)


async def binance_feed(broker: PriceBroker) -> None:
    """ONE upstream WebSocket for all crypto symbols (Binance combined stream).
    miniTicker pushes once per second per symbol: c = last price, o = 24 h open, E = event time (ms)."""
    streams = "/".join(f"{s}@miniTicker" for s in CRYPTO.values())
    to_ours = {binance.upper(): ours for ours, binance in CRYPTO.items()}  # 'BTCUSDT' -> 'BTC'

    async with connect(f"{settings.binance_ws_url}?streams={streams}", ping_interval=20) as ws:
        stats.binance_connections += 1
        log.info("Binance connected: 1 upstream socket for %d symbols", len(CRYPTO))
        async for raw in ws:
            rx = int(time.time() * 1000)  # receive time, first thing (latency tracing: exchange → us)
            data = json.loads(raw)["data"]
            symbol = to_ours.get(data["s"])
            if symbol is None:
                continue
            stats.binance_messages += 1
            await broker.publish(symbol, float(data["c"]), float(data["o"]), int(data["E"]), rx)


async def simulated_stock_feed(broker: PriceBroker, interval_s: float = 1.5) -> None:
    """Server-side random walk for NSE stocks, published exactly like real ticks."""
    prices = dict(SIMULATED_STOCKS)
    while True:
        ts = int(time.time() * 1000)
        for symbol, base in SIMULATED_STOCKS.items():
            # Symmetric ±0.4 % step: no upward drift (the old frontend walk had one, Backlog #2).
            prices[symbol] = max(0.01, prices[symbol] * (1 + random.uniform(-0.004, 0.004)))
            await broker.publish(symbol, round(prices[symbol], 2), base, ts)
        await asyncio.sleep(interval_s)
