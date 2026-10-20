"""FastAPI entry point: auth + portfolio REST API and the live-price WebSocket, in one app."""

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI
from redis.asyncio import Redis

from .config import settings
from .db import Base, engine, migrate
from .realtime.alerts_engine import AlertEngine
from .realtime.broker import PriceBroker
from .realtime.feeds import binance_feed, run_forever, simulated_stock_feed
from .realtime.hub import ConnectionHub
from .realtime.stats import stats
from .routers import alerts, auth, portfolio, ws

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creates tables if missing. Fine for a side project; a real one would use Alembic migrations.
    migrate()
    Base.metadata.create_all(engine)

    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    broker = PriceBroker(redis)
    hub = ConnectionHub(redis)
    alert_engine = AlertEngine(redis)
    app.state.redis, app.state.broker, app.state.hub = redis, broker, hub

    tasks = [
        asyncio.create_task(run_forever("redis-listener", hub.listen)),
        asyncio.create_task(run_forever("alert-engine", alert_engine.run)),
        asyncio.create_task(run_forever("simulated-feed", lambda: simulated_stock_feed(broker))),
    ]
    if settings.enable_binance:
        tasks.append(asyncio.create_task(run_forever("binance-feed", lambda: binance_feed(broker))))

    yield

    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await redis.aclose()


app = FastAPI(title="Price Tracker API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(portfolio.router)
app.include_router(alerts.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health() -> dict:
    try:
        redis_ok = bool(await app.state.redis.ping())
    except Exception:  # noqa: BLE001
        redis_ok = False
    return {"redis": redis_ok, **asdict(stats)}
