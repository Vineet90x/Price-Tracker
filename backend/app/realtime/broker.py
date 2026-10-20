"""The publishing side of pub-sub. Feeds call publish(); they never know who is listening."""

import asyncio
import json

from redis.asyncio import Redis

from .stats import stats

HISTORY_LEN = 300  # last 300 ticks per symbol (≈5 min of Binance 1 s ticks), sent to new subscribers


def channel(symbol: str) -> str:
    return f"prices:{symbol}"


class PriceBroker:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def publish(self, symbol: str, price: float, open_: float, ts_ms: int, rx_ms: int | None = None) -> None:
        # ts = when the exchange says the price happened; rx = when OUR server received it (latency tracing)
        tick = json.dumps({"symbol": symbol, "price": price, "open": open_, "ts": ts_ms, "rx": rx_ms or ts_ms})
        # One round-trip for 4 commands. transaction=False: we don't need MULTI/EXEC atomicity.
        pipe = self.redis.pipeline(transaction=False)
        pipe.set(f"price:last:{symbol}", tick)
        pipe.rpush(f"price:history:{symbol}", json.dumps([ts_ms, price]))
        pipe.ltrim(f"price:history:{symbol}", -HISTORY_LEN, -1)
        pipe.publish(channel(symbol), tick)
        await pipe.execute()
        stats.published += 1

    async def snapshot(self, symbol: str) -> dict | None:
        """Latest tick + recent history, so a new subscriber can draw a chart immediately."""
        last, history = await asyncio.gather(
            self.redis.get(f"price:last:{symbol}"),
            self.redis.lrange(f"price:history:{symbol}", 0, -1),
        )
        if last is None:
            return None
        return {"type": "snapshot", **json.loads(last), "history": [json.loads(p) for p in history]}
