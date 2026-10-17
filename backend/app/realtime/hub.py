"""The subscribing side of pub-sub, plus the local connection registry.

Each backend instance holds ONE Redis subscription (pattern prices:*) and fans each message out
to its own connected browsers. So Redis connections grow with server instances, not with users.
"""

import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket
from redis.asyncio import Redis

from .stats import stats

log = logging.getLogger("hub")


class ConnectionHub:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis
        self._by_symbol: dict[str, set[WebSocket]] = defaultdict(set)

    def add(self, ws: WebSocket, symbol: str) -> None:
        self._by_symbol[symbol].add(ws)

    def remove(self, ws: WebSocket, symbol: str) -> None:
        self._by_symbol[symbol].discard(ws)

    def remove_all(self, ws: WebSocket) -> None:
        for sockets in self._by_symbol.values():
            sockets.discard(ws)

    async def listen(self) -> None:
        """Runs for the app's lifetime (wrapped in run_forever, so a Redis outage is retried)."""
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("prices:*")
        try:
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                symbol = message["channel"].split(":", 1)[1]
                await self._broadcast(symbol, json.dumps({"type": "tick", **json.loads(message["data"])}))
        finally:
            await pubsub.aclose()

    async def _broadcast(self, symbol: str, text: str) -> None:
        targets = list(self._by_symbol.get(symbol, ()))
        if not targets:
            return
        # Known limit: one slow client delays this loop for everyone. Production would give each
        # client its own bounded send queue and drop/close clients that fall behind.
        results = await asyncio.gather(*(ws.send_text(text) for ws in targets), return_exceptions=True)
        for ws, result in zip(targets, results):
            if isinstance(result, Exception):
                self.remove_all(ws)
            else:
                stats.ws_messages_sent += 1
