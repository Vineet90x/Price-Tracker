"""Price alerts REST API (login required). The AlertEngine does the actual watching."""

import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..db import SessionLocal
from ..deps import get_current_user
from ..models import PriceAlert, User
from ..realtime.alerts_engine import CHANGED_CHANNEL
from ..symbols import ALL_SYMBOLS

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

MAX_ACTIVE_ALERTS = 50
HISTORY_LIMIT = 20  # triggered alerts returned with the list


class AlertIn(BaseModel):
    symbol: str
    direction: Literal["above", "below"]
    target_price: float = Field(gt=0)


class AlertOut(BaseModel):
    id: int
    symbol: str
    direction: str
    target_price: float
    status: str
    created_at: datetime
    triggered_at: datetime | None
    triggered_price: float | None

    @classmethod
    def of(cls, a: PriceAlert) -> "AlertOut":
        return cls(id=a.id, symbol=a.symbol, direction=a.direction, target_price=a.target_price,
                   status=a.status, created_at=a.created_at, triggered_at=a.triggered_at,
                   triggered_price=a.triggered_price)


@router.get("", response_model=list[AlertOut])
def list_alerts(user: User = Depends(get_current_user)) -> list[AlertOut]:
    """All active alerts + the most recent triggered ones (to show what fired while you were away)."""
    with SessionLocal() as db:
        active = db.scalars(
            select(PriceAlert).where(PriceAlert.user_id == user.id, PriceAlert.status == "active")
            .order_by(PriceAlert.created_at.desc())
        ).all()
        triggered = db.scalars(
            select(PriceAlert).where(PriceAlert.user_id == user.id, PriceAlert.status == "triggered")
            .order_by(PriceAlert.triggered_at.desc()).limit(HISTORY_LIMIT)
        ).all()
        return [AlertOut.of(a) for a in [*active, *triggered]]


@router.post("", response_model=AlertOut, status_code=status.HTTP_201_CREATED)
async def create_alert(body: AlertIn, request: Request, user: User = Depends(get_current_user)) -> AlertOut:
    if body.symbol not in ALL_SYMBOLS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown_symbol")

    # An alert that is already true would fire on the next tick, which is almost always a mistake
    # (e.g. "above 100" while the price is 120). Checked against the live price (fixes Backlog #5).
    redis = request.app.state.redis
    last = await redis.get(f"price:last:{body.symbol}")
    if last is not None:
        current = json.loads(last)["price"]
        if (body.direction == "above" and current >= body.target_price) or (
            body.direction == "below" and current <= body.target_price
        ):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "would_trigger_immediately")

    def insert() -> PriceAlert:
        with SessionLocal() as db:
            active_count = db.scalar(
                select(func.count()).select_from(PriceAlert)
                .where(PriceAlert.user_id == user.id, PriceAlert.status == "active")
            )
            if active_count >= MAX_ACTIVE_ALERTS:
                raise HTTPException(status.HTTP_409_CONFLICT, "too_many_alerts")
            alert = PriceAlert(user_id=user.id, symbol=body.symbol, direction=body.direction,
                               target_price=body.target_price)
            db.add(alert)
            db.commit()
            db.refresh(alert)
            return alert

    # Blocking DB work goes to a thread so this async endpoint doesn't stall the event loop.
    alert = await run_in_threadpool(insert)
    await redis.publish(CHANGED_CHANNEL, "created")  # every AlertEngine reloads its in-memory index
    return AlertOut.of(alert)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_alert(alert_id: int, request: Request, user: User = Depends(get_current_user)) -> Response:
    def cancel() -> bool:
        with SessionLocal() as db:
            alert = db.get(PriceAlert, alert_id)
            if alert is None or alert.user_id != user.id:
                return False  # someone else's alert looks exactly like a missing one
            if alert.status == "active":
                alert.status = "cancelled"
                db.commit()
            return True

    if not await run_in_threadpool(cancel):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert_not_found")
    await request.app.state.redis.publish(CHANGED_CHANNEL, "cancelled")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
