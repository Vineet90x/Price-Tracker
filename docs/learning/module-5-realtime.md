# Module 5: Real-time Systems

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 4](module-4-security.md) · Next: [Module 6: Infrastructure](module-6-infrastructure.md)

This is the heart of the project: getting a price from Binance onto thousands of screens within milliseconds,
efficiently, and surviving when connections break.

```
Binance ──1 socket──► backend feed ──PUBLISH──► Redis ──► each backend instance ──► its browsers (WebSocket)
```

---

## 5.1 Polling vs long-polling vs SSE vs WebSockets

**What it is.** Four ways for a browser to get *new* data:

| Technique | Analogy | How | Good for |
|---|---|---|---|
| **Polling** | Asking "any news?" every second | `setInterval(fetch, 1000)` | Rare updates, simple setups |
| **Long-polling** | Asking, and the shop keeps you on hold until there *is* news | the request stays open until data arrives, then repeat | Old browsers, no WebSocket support |
| **SSE** (Server-Sent Events) | A radio: the server talks, you listen | one long HTTP response that streams events; reconnects automatically | Server → client only (notifications, feeds) |
| **WebSocket** | A phone call: both talk any time | HTTP upgrades (`101 Switching Protocols`) to a two-way message channel | Two-way, low latency (chat, games, trading) |

**How it works in our project.** The browser opens one WebSocket [websocket-price-feed.ts:L62](../../frontend/src/app/core/services/websocket-price-feed.ts#L62)
to [ws.py:L37](../../backend/app/routers/ws.py#L37) and speaks a tiny JSON protocol: the client
sends `subscribe`/`unsubscribe`, the server sends `snapshot`/`tick`. nginx must pass the upgrade headers through
[nginx.conf:L28-L29](../../frontend/nginx.conf#L28-L29).

**Why we chose it.** Prices change every second, and the client also *sends* messages (subscribe when you add a
symbol). Honest note: SSE could have worked too (put the symbol list in the URL and reconnect when it changes, with
automatic reconnection built in). WebSockets were the build guide's goal, and they're what trading apps use.

**How it helps.** Polling math for 1M users at 1 request/second: **1M HTTP requests per second**, each with headers,
auth checks and mostly "nothing changed". With push, the server sends only when a price actually changes.

**At large scale.** WebSockets are **stateful long-lived connections**. Load balancers must support them (idle
timeouts! our nginx uses 1 h [nginx.conf:L33](../../frontend/nginx.conf#L33)), deploys must drain connections gracefully, and
capacity is measured in *concurrent connections* (memory per socket), not requests per second.

**Interview angle.** *"Why WebSockets over polling? Over SSE?"* Push vs pull cost; two-way vs one-way.
*"What's hard about WebSockets in production?"* Sticky long-lived connections, load-balancer timeouts,
reconnect storms, scaling by connection count.

---

## 5.2 WebSocket lifecycle, reconnection, backoff + jitter

**What it is.** Connections **will** break: Wi-Fi switches, laptops sleep, servers deploy, upstreams hiccup. A
real-time client must notice, reconnect, and restore its state, without hammering the server.

**How it works.**
- **Lifecycle:** HTTP upgrade → open → messages both ways → close. A close has a code: `1000` normal, `1006`
  abnormal (no close frame, e.g. network died), `1011` server error, `1012` service restart.
- **Heartbeats:** idle TCP connections can die silently (a router forgets them). Ping/pong frames every ~20 s
  detect that; our Binance client pings with `ping_interval=20` [feeds.py:L46](../../backend/app/realtime/feeds.py#L46).
- **Exponential backoff + jitter** [websocket-price-feed.ts:L33-L36](../../frontend/src/app/core/services/websocket-price-feed.ts#L33-L36): wait
  1 s, 2 s, 4 s … max 30 s, plus random 0–20 %. Without jitter, every client dropped by the same server restart
  would reconnect in the **same millisecond** (a *thundering herd*) and could knock the server over again.
- **Clean close vs error:** the browser stream *completes* on a clean close; we convert that to an error so a single
  `retry` handles both [websocket-price-feed.ts:L83](../../frontend/src/app/core/services/websocket-price-feed.ts#L83).
- **Restore state:** a new socket knows nothing, so on open we re-send every wanted symbol
  [websocket-price-feed.ts:L63-L71](../../frontend/src/app/core/services/websocket-price-feed.ts#L63-L71), and the server answers with fresh snapshots.

**Real example from today's logs (backend → Binance, same pattern on the server side):**
```
19:56:50 binance-feed retry in 16s
19:57:10 binance-feed failed: gaierror(-5, 'No address associated with hostname')   ← DNS failed
19:57:10 binance-feed retry in 30s                                                   ← capped at 30 s
19:57:41 Binance connected: 1 upstream socket for 11 symbols                        ← recovered by itself
```
Earlier: `1011 keepalive ping timeout` → reconnected 1.6 s later. The wrapper doing this is
[feeds.py:L20](../../backend/app/realtime/feeds.py#L20).

**Why we chose it.** The build guide's "done when": kill the backend, watch the app recover without a page refresh.
It's covered by a unit test with a fake WebSocket.

**How it helps.** Users see "Reconnecting…" and then live prices again, with no reload and no lost subscriptions.

**At large scale.**
- **Resume instead of restart:** send the last seen timestamp/sequence number so the server sends only what you
  missed, instead of full snapshots for everyone at once.
- **Server-guided backoff:** during an overload the server can tell clients "retry after 20 s".
- **Graceful deploys:** drain an instance (stop new connections, close old ones gradually), so not all clients
  reconnect at once.

**Interview angle.** *"How do you handle a dropped WebSocket?"* Detect (close event/heartbeat), reconnect with
exponential backoff + jitter, re-subscribe, resync state, show the status in the UI. *"What is a thundering herd?"*
Many clients retrying in sync; jitter spreads them out.

---

## 5.3 Pub-sub, fan-out, Redis

**What it is.**
- **Pub-sub** (publish-subscribe): publishers send messages to a named **channel** without knowing who listens;
  subscribers listen to channels without knowing who publishes. Like a radio station and its listeners.
- **Fan-out:** one message delivered to many receivers.
- **Redis:** a very fast **in-memory** data server. We use three of its features:
  - **Strings** `price:last:BTC`: the latest tick (our real value: `{"symbol": "BTC", "price": 81629.58, "open": 81660.02, "ts": 1792267662015}`).
  - **Lists** `price:history:BTC`: the last 300 ticks (`RPUSH` + `LTRIM` keeps it bounded).
  - **Pub/Sub channels** `prices:BTC`, …

**How it works.**
1. The Binance feed (one connection for all 11 coins) and the simulated feed call `publish()`, which in one round
   trip stores latest + history and publishes to `prices:<SYMBOL>` [broker.py:L21-L30](../../backend/app/realtime/broker.py#L21-L30).
2. Each backend **instance** holds **one** pattern subscription `prices:*` [hub.py:L57-L75](../../backend/app/realtime/hub.py#L57-L75)
   (Redis reports exactly 1 pattern subscriber right now).
3. The hub's in-memory registry knows which local sockets want which symbol and forwards the message
   [hub.py:L79-L84](../../backend/app/realtime/hub.py#L79-L84).
4. **Pub/sub is fire-and-forget:** Redis does *not* store channel messages. A client that connects later would
   miss everything, which is why `subscribe` first sends a **snapshot** built from the stored latest/history keys
   [broker.py:L33](../../backend/app/realtime/broker.py#L33). The socket is registered *before* the snapshot is read,
   so no tick falls into the gap [ws.py:L55](../../backend/app/routers/ws.py#L55).

Try it: `docker exec -it price_tracker_redis redis-cli PSUBSCRIBE 'prices:*'` (watch the ticks flow), or
`GET price:last:ETH`, or `LRANGE price:history:BTC -5 -1`.

**Why we chose it.** It decouples **fetching** (once, however many users) from **delivering** (once per user).
That's the core lesson of the project: `/api/health` showed `binance_connections: 1` with several clients connected.

**How it helps.** Add users → no extra load on Binance. Add backend instances → each subscribes once; Redis does the copying.

**At large scale.**
- **Throughput:** one Redis handles hundreds of thousands of small messages per second. Our load is roughly
  ~25 ticks/s × number of instances, which is tiny.
- **Redis is a single point of failure:** use a managed Redis with a replica + automatic failover. Today, if Redis
  dies, prices freeze until it's back (we accepted that; Decision Log).
- **Sharded pub/sub** (Redis 7 `SSUBSCRIBE`) or Redis Cluster when one node isn't enough.
- **Need replay or durability?** Pub/sub can't replay. Use a log: **Redis Streams**, **Kafka**, NATS JetStream
  (consumers can re-read from an offset).

**Interview angle.** *"Why doesn't Binance get one connection per user?"* Ingestion is separated from delivery
by pub-sub. *"What if Redis goes down?"* Prices stop; mitigate with a replica/failover and a "stale" indicator.
*"Pub/sub vs a message queue vs a log (Kafka)?"* Broadcast-and-forget / each message to one worker / durable,
replayable history.

---

## 5.4 Backpressure and slow consumers

**What it is.** **Backpressure** is what happens when data arrives faster than someone can take it. Like a
conveyor belt into a slow packer: boxes pile up, and you must slow the belt, add packers, or throw boxes away.

**How it works / where it hits us.**
- **Server side (originally):** the hub sent each tick to all sockets and *waited for all of them*. If one phone on a
  bad network couldn't receive fast enough, its TCP buffer filled and `send` waited, delaying delivery for everyone
  else (Backlog #21). The load test in [Module 8.3](module-8-real-world-features.md#83-load-testing-and-fixing-slow-clients)
  proved it: 5 slow clients made everyone's p99 7× worse. **Now fixed** with a per-client outbox
  [client.py:L55-L67](../../backend/app/realtime/client.py#L55-L67); the hub's broadcast never waits
  [hub.py:L79-L84](../../backend/app/realtime/hub.py#L79-L84).
- **Client side:** ticks can arrive faster than it's worth rendering, so we **conflate**: `auditTime(250)` keeps only
  the latest state per 250 ms window [price.service.ts:L66](../../frontend/src/app/core/services/price.service.ts#L66).

**The fix (now implemented, steps 1–3; see Module 8.3).**
1. Give every client its **own bounded queue** and its own sender task; the broadcaster only drops messages into
   queues, which never waits.
2. **Conflate per symbol:** for prices only the *latest* value matters, so if BTC changes 3 times before a slow
   client's queue drains, send only the newest one.
3. If a client stays too far behind, **disconnect it** (it will reconnect and get a fresh snapshot).
4. **Batch:** one frame every 250 ms containing all changed symbols instead of one frame per tick.

**Measured result:** with 5 slow clients, p99 for everyone else went from 266 ms back to 36 ms; under overload from
10 s late to 65 ms. Step 4 (one batched frame per client) is still open.

**Interview angle.** *"What happens when one client is slow?"* Without isolation it slows everyone; with per-client
queues + conflation + eviction, only that client sees stale data. *"Why is conflation OK for prices but not for chat?"*
Prices are "latest state" (old values are worthless); chat messages are events, and each one matters.
