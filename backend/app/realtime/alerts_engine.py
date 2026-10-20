"""Checks every live tick against users' active price alerts, on the server.

Flow:  Redis prices:<SYMBOL>  ──►  AlertEngine.check  ──►  DB: status active → triggered (exactly once)
                                                     └──►  Redis alerts:user:<id>  ──►  hub ──► that user's sockets

Exactly once: several backend instances may run this engine at the same time. Each one tries
"UPDATE … SET status='triggered' WHERE id=? AND status='active'"; the database lets only ONE of them
change the row, and only that one sends the notification.
"""

import asyncio
import json
import logging
from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy import select, update

from ..db import SessionLocal
from ..models import PriceAlert, utcnow

log = logging.getLogger("alerts")

CHANGED_CHANNEL = "alerts:changed"  # published after an alert is created/cancelled → every engine reloads


def user_channel(user_id: int) -> str:
    return f"alerts:user:{user_id}"


@dataclass(frozen=True)
class ActiveAlert:
    id: int
    user_id: int
    symbol: str
    direction: str
    target_price: float

    def is_hit(self, price: float) -> bool:
        return price >= self.target_price if self.direction == "above" else price <= self.target_price


def _load_active() -> list[ActiveAlert]:
    with SessionLocal() as db:
        rows = db.scalars(select(PriceAlert).where(PriceAlert.status == "active")).all()
        return [ActiveAlert(r.id, r.user_id, r.symbol, r.direction, r.target_price) for r in rows]


def _mark_triggered(alert_id: int, price: float) -> bool:
    """True only for the one caller whose UPDATE actually changed the row."""
    with SessionLocal() as db:
        result = db.execute(
            update(PriceAlert)
            .where(PriceAlert.id == alert_id, PriceAlert.status == "active")
            .values(status="triggered", triggered_at=utcnow(), triggered_price=price)
        )
        db.commit()
        return result.rowcount == 1


class AlertEngine:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis
        # symbol → its active alerts. Kept in memory so a tick needs no database query.
        self._by_symbol: dict[str, list[ActiveAlert]] = {}

    async def reload(self) -> None:
        # The DB driver is blocking; run it in a worker thread so the event loop keeps serving sockets.
        alerts = await asyncio.to_thread(_load_active)
        index: dict[str, list[ActiveAlert]] = {}
        for alert in alerts:
            index.setdefault(alert.symbol, []).append(alert)
        self._by_symbol = index
        log.info("alert engine: %d active alerts", len(alerts))

    async def run(self) -> None:
        """Runs for the app's lifetime (wrapped in run_forever, so Redis outages are retried)."""
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("prices:*")
        await pubsub.subscribe(CHANGED_CHANNEL)
        await self.reload()  # after subscribing, so no change notification can slip in between
        try:
            async for message in pubsub.listen():
                if message["type"] == "message" and message["channel"] == CHANGED_CHANNEL:
                    await self.reload()
                elif message["type"] == "pmessage":
                    tick = json.loads(message["data"])
                    await self.check(tick["symbol"], tick["price"])
        finally:
            await pubsub.aclose()

    async def check(self, symbol: str, price: float) -> None:
        candidates = self._by_symbol.get(symbol)
        if not candidates:
            return
        hit = [a for a in candidates if a.is_hit(price)]
        if not hit:
            return
        # Remove before the slow DB step, so the next tick can't pick the same alert up again.
        self._by_symbol[symbol] = [a for a in candidates if a not in hit]
        for alert in hit:
            if not await asyncio.to_thread(_mark_triggered, alert.id, price):
                continue  # another instance fired it first, or the user just cancelled it
            event = {
                "type": "alert",
                "id": alert.id,
                "symbol": alert.symbol,
                "direction": alert.direction,
                "target_price": alert.target_price,
                "triggered_price": price,
                "triggered_at": utcnow().isoformat() + "Z",
            }
            await self.redis.publish(user_channel(alert.user_id), json.dumps(event))
            log.info("alert %d fired for user %d: %s %s %s at %s",
                     alert.id, alert.user_id, alert.symbol, alert.direction, alert.target_price, price)
