"""One connected browser's outbox. Fixes "one slow client delays everyone" (Backlog #21).

Before: the hub sent each tick to every socket and WAITED for all of them, so one client on a bad
connection held up delivery for all others.
Now: the hub only drops messages into each client's outbox (instant, never waits); every client has its
own sender task that does the actual, possibly slow, sending.

Two kinds of messages:
- price ticks: CONFLATED. Only the newest unsent price per symbol is kept, because an older price is
  worthless once a newer one exists. A slow client therefore gets fewer, but always current, prices,
  and its outbox can never hold more than one tick per subscribed symbol.
- everything else (snapshots, alerts, pongs, auth results): kept in order, up to MAX_DIRECT.
A client that can't accept a single message for SEND_TIMEOUT seconds is disconnected; it reconnects by
itself (the browser has backoff + resubscribe) and gets fresh snapshots.
"""

import asyncio
import json
import logging
from collections import deque

from fastapi import WebSocket

from .stats import stats

log = logging.getLogger("client")

MAX_DIRECT = 200
SEND_TIMEOUT = 10.0


class ClientConnection:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self._ticks: dict[str, str] = {}  # symbol → newest unsent tick (JSON text)
        self._direct: deque[str] = deque()
        self._wakeup = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    def push_tick(self, symbol: str, text: str) -> None:
        if symbol in self._ticks:
            stats.ws_ticks_conflated += 1  # an unsent older price is replaced by this newer one
        self._ticks[symbol] = text
        self._wakeup.set()

    def push(self, message: str | dict) -> None:
        if len(self._direct) >= MAX_DIRECT:
            return self._evict("outbox full")
        self._direct.append(message if isinstance(message, str) else json.dumps(message))
        self._wakeup.set()

    def stop(self) -> None:
        self._task.cancel()

    async def _run(self) -> None:
        try:
            while True:
                await self._wakeup.wait()
                self._wakeup.clear()
                while self._direct or self._ticks:
                    if self._direct:
                        text = self._direct.popleft()  # snapshots/alerts first, in order
                    else:
                        symbol = next(iter(self._ticks))  # oldest pending symbol first: fair across symbols
                        text = self._ticks.pop(symbol)
                    await asyncio.wait_for(self.ws.send_text(text), timeout=SEND_TIMEOUT)
                    stats.ws_messages_sent += 1
        except asyncio.TimeoutError:
            self._evict(f"could not take a message for {SEND_TIMEOUT:.0f}s")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — socket already closed: the receive loop cleans up
            pass

    def _evict(self, reason: str) -> None:
        stats.ws_slow_disconnects += 1
        log.info("disconnecting slow client: %s", reason)
        self._task.cancel()
        # 1013 = "try again later". Don't wait for the close handshake: this client is not reading anyway.
        asyncio.create_task(self._close_quietly())

    async def _close_quietly(self) -> None:
        try:
            await asyncio.wait_for(self.ws.close(code=1013), timeout=1)
        except Exception:  # noqa: BLE001
            pass
