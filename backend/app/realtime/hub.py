"""The subscribing side of pub-sub, plus the local connection registry.

Each backend instance holds ONE Redis subscription (patterns prices:* and alerts:user:*) and fans each
message out to its own connected browsers. So Redis connections grow with server instances, not with users.
"""

import json
import logging
import time
from collections import defaultdict

from fastapi import WebSocket
from redis.asyncio import Redis

from .client import ClientConnection

log = logging.getLogger("hub")


class ConnectionHub:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis
        self._clients: dict[WebSocket, ClientConnection] = {}
        self._by_symbol: dict[str, set[WebSocket]] = defaultdict(set)
        # Logged-in sockets, for private messages (fired alerts). One user may have several tabs open.
        self._by_user: dict[int, set[WebSocket]] = defaultdict(set)
        self._user_of: dict[WebSocket, int] = {}

    def connect(self, ws: WebSocket) -> ClientConnection:
        """Every socket gets its own outbox + sender task (see client.py)."""
        client = self._clients[ws] = ClientConnection(ws)
        return client

    def add(self, ws: WebSocket, symbol: str) -> None:
        self._by_symbol[symbol].add(ws)

    def remove(self, ws: WebSocket, symbol: str) -> None:
        self._by_symbol[symbol].discard(ws)

    def set_user(self, ws: WebSocket, user_id: int | None) -> None:
        """Link a socket to a user (after it sent a valid token), or unlink it (logout: None)."""
        old = self._user_of.pop(ws, None)
        if old is not None:
            self._by_user[old].discard(ws)
        if user_id is not None:
            self._user_of[ws] = user_id
            self._by_user[user_id].add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        for sockets in self._by_symbol.values():
            sockets.discard(ws)
        self.set_user(ws, None)
        client = self._clients.pop(ws, None)
        if client:
            client.stop()

    async def listen(self) -> None:
        """Runs for the app's lifetime (wrapped in run_forever, so a Redis outage is retried)."""
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("prices:*", "alerts:user:*")
        try:
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                channel: str = message["channel"]
                if channel.startswith("alerts:user:"):
                    # Already a complete {"type": "alert", …} message from the AlertEngine.
                    user_id = int(channel.rsplit(":", 1)[1])
                    for ws in self._by_user.get(user_id, ()):
                        self._clients[ws].push(message["data"])
                else:
                    symbol = channel.split(":", 1)[1]
                    tick = json.loads(message["data"])
                    tick["tx"] = int(time.time() * 1000)  # leaving our server (latency tracing)
                    self._broadcast(symbol, json.dumps({"type": "tick", **tick}))
        finally:
            await pubsub.aclose()

    def _broadcast(self, symbol: str, text: str) -> None:
        # Not async, nothing awaited: dropping a message into N outboxes takes microseconds, so one
        # slow client can no longer hold up the others (Backlog #21, fixed; see client.py).
        for ws in self._by_symbol.get(symbol, ()):
            self._clients[ws].push_tick(symbol, text)
