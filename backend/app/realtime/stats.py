"""In-process counters exposed by /api/health. They prove the fan-out claim:
binance_connections stays at 1 no matter how many browser tabs are connected."""

from dataclasses import dataclass


@dataclass
class Stats:
    binance_connections: int = 0  # times we (re)connected upstream, NOT one per client
    binance_messages: int = 0
    published: int = 0
    ws_clients: int = 0
    ws_messages_sent: int = 0
    ws_ticks_conflated: int = 0  # older unsent prices replaced by newer ones (slow clients)
    ws_slow_disconnects: int = 0  # clients dropped because they stopped accepting messages


stats = Stats()
