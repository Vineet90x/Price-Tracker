# Module 7: Scale, Cost and System Design

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 6](module-6-infrastructure.md)

The interview scenario: *"This works for you. Now a million people use it at the same time. What breaks, and what do you change?"*
This module gives you the vocabulary (7.1, 7.3), the walkthrough (7.2) and the back-of-envelope cost maths (7.4).
**All numbers here are estimates** to show the *method*. In a real project you'd confirm them with a load test.

---

## 7.1 Vertical vs horizontal scaling, stateless services, load balancers

**What it is.**
- **Vertical scaling** ("scale up"): a bigger machine. Simple, but it has a ceiling, gets expensive, and it's still one point of failure.
- **Horizontal scaling** ("scale out"): more machines running the same thing, with a **load balancer** spreading users across them.
- Horizontal scaling only works for **stateless** services: any instance can handle any request because nothing
  important is stored *inside* the instance; it's in a shared database or cache.

**How our project scores, piece by piece.**

| Piece | Stateless? | Can we just add copies? |
|---|---|---|
| nginx / static files | yes | yes (or a CDN) |
| Auth/REST API | **almost**: the JWT is self-contained, sessions are in the DB… | ❌ blocked by **SQLite** (a file on one machine's disk). Postgres fixes it |
| WebSocket servers | holds *connection* state (who wants which symbol) | ✅ fine: a reconnecting client re-subscribes on any instance (5.2); each instance subscribes to Redis once |
| Feeds (Binance + simulator) | a **singleton**: there must be exactly one | ❌ today every copy would start its own feeds (Backlog #20) → move to a separate worker |
| Redis, database | stateful by nature | scaled differently: managed services, replicas, failover |

**Load balancer choices.** Round-robin is fine for short HTTP requests. For WebSockets use **least connections**
(connections last for hours, so balance by how many each server holds). No sticky sessions are needed.

**Interview angle.** *"What makes a service horizontally scalable?"* No local state that matters; shared state lives in
a DB/cache. *"Which part of your system is hardest to scale?"* The singleton feed (must be one, highly available) and
the stateful stores; then per-client bandwidth.

---

## 7.2 The million-users walkthrough

**Assumptions** (say them out loud in an interview): 1,000,000 **concurrent** users, each watching ~5 symbols that tick
about once a second → ~5 million price updates per second to deliver. ~10 % log in during the busiest hour.

### Target architecture
```
                     ┌──────────── CDN (static Angular files) ─────────────┐
Users ──DNS──► Load balancer (TLS, WebSocket-aware, least-connections)
                     │                                  │
              REST API instances ×N               WebSocket instances ×~50
              (stateless, autoscaled)             (each ~20k connections,
                     │                             1 Redis subscription each)
               Postgres (+ read replica)                   │
               Redis (sessions cache)        Redis pub/sub (managed, with replica)
                                                          ▲
                                     Ingest worker (exactly 1 active + 1 standby)
                                     Binance stream + simulator ──► PUBLISH
```

### What breaks first, and the fix, in the order you'd hit it

| # | Breaks at… | Symptom | Fix |
|---|---|---|---|
| 1 | **~1,000 users per process (measured, 8.3)**; connection bursts > ~100/s get refused | One Python process: CPU for JSON, snapshots and sending; ~180 KB per client | More WebSocket instances behind a least-connections load balancer |
| 2 | The 2nd instance | Duplicate Binance sockets and simulated ticks (Backlog #20) | Separate **ingest worker**, leader election or a single replica with a standby |
| 3 | The 2nd API instance | SQLite on one disk (Backlog #22) | **Postgres** + Alembic migrations; Redis cache for the per-request session check |
| 4 | Slow mobile clients | ~~One slow client delays others~~ **fixed and measured (8.3)** | Per-client outbox, per-symbol conflation, evict laggards |
| 5 | ~100k users | **Bandwidth** becomes the main cost (7.4) | Batch per client, binary encoding, compression, only symbols in view |
| 6 | Deploys / outages | 1M clients reconnect at once (thundering herd) | Jittered backoff (have it), connection draining, server-sent retry hints, resume from last sequence number |
| 7 | Login peaks | Argon2 is deliberately CPU-heavy (64 MB per hash) | Rate limits, separate auth service sized for peaks, passkeys/social login |
| 8 | Everywhere | "Is it working?" across ~60 machines | Metrics (connections, msg/s, **feed lag**), alerts, structured logs, autoscaling on connection count |
| 9 | Global users | 200 ms+ round trips from far away | Edge/regional WebSocket clusters, each fed by the central ingest (or a regional Redis replica) |

### Rough capacity maths
- **Connections:** 1,000,000 ÷ ~20,000 per instance ≈ **50 WebSocket instances**. ⚠ **Correction from the load test (8.3):**
  one Python process on a Windows laptop handled ~1,000 clients at p95 < 400 ms. Assume that until a Linux server with
  several worker processes is measured; it could mean ~1,000 instances, or (better) fewer, more efficient ones. **Measure, don't assume.** Memory: if each idle connection
  costs ~40 KB in Python (estimate), 1M connections ≈ 40 GB of RAM across the fleet.
- **Redis:** ~25 ticks/s published × 50 subscribed instances ≈ 1,250 deliveries/s: trivial for Redis.
- **Fan-out at the edge:** 5,000,000 messages/s leave the WebSocket tier. *This* is the real workload, and why
  per-client efficiency (batching, encoding) matters more than anything upstream.

### The one-paragraph interview answer
*"I'd separate ingestion from delivery: one highly available ingest worker publishes to Redis, and a
horizontally scaled, stateless WebSocket tier behind a least-connections load balancer subscribes once per
instance and fans out locally. Static files go to a CDN, auth moves to Postgres with a Redis session cache.
At a million users the bottleneck and the cost is egress bandwidth, so I'd batch updates per client, use a
compact binary format with compression, and only send symbols the user is looking at. I'd add backpressure
handling for slow clients, jittered reconnects with resume for deploys, and alert on connection counts and
feed lag."*

---

## 7.3 Caching and CDNs

**What it is.** A **cache** keeps a copy of something close to where it's needed, so you don't fetch or recompute it
each time. A **CDN** is a worldwide network of caches for files, so users download from a server near them.

**What can be cached in this project, and what can't:**

| Thing | Cacheable? | How long / why |
|---|---|---|
| `main-K3NLUO42.js`, CSS, fonts | ✅ CDN + browser, **1 year** | The hash in the name changes when content changes (1.3) |
| `index.html` | ✅ but **short** (seconds–minutes) | It references the hashed files; it must update on deploy |
| `/watchlist` prerendered HTML | ✅ short TTL | Same reason |
| `GET /api/auth/config` | ✅ minutes | Same for everyone, rarely changes |
| Latest prices | ✅ **in Redis** (`price:last:*`), already done | Snapshots for new subscribers |
| WebSocket stream | ❌ | Live, per-connection |
| `/api/portfolio`, `/api/auth/*` | ❌ (or `private` browser cache only) | Per-user and/or security-sensitive |

**Why it matters.** Every cache hit is a request your servers never see. With hashed file names, *cache
invalidation* (famously one of the hardest problems in computer science) mostly disappears for static assets.

**Interview angle.** *"What would you put on a CDN?"* Static assets with long TTLs; HTML with short TTLs; never
per-user data. *"How do you invalidate?"* Content-hashed file names; short TTLs for entry points; explicit purge on deploy.

---

## 7.4 Cost thinking

**Method:** find the quantity that grows fastest with users, then put a price on it.

**Bandwidth (the dominant cost for live data):**
```
bytes/second = users × messages per user per second × bytes per message
```
- **Naive (today's format):** each tick is its own JSON WebSocket message, ~90 bytes of payload plus
  ~50 bytes of TCP/IP + framing overhead. 5 ticks/s × ~140 B ≈ **700 B/s per user**.
  × 1,000,000 users ≈ **700 MB/s** ≈ **1.8 PB per month** (700 MB/s × ~2.6 million seconds).
- **Optimised:** batch ticks per client (overhead paid once per frame), binary encoding (~10–15 B per tick instead
  of ~90), compression, and fewer updates for symbols off-screen. Aiming at ~**100 B/s per user** ≈ 0.26 PB per month.
- **Putting a price on it:** cloud egress is billed per GB. At an *assumed* $0.05/GB (real prices vary by provider,
  region and volume), 1.8 PB ≈ **$90k/month** vs 0.26 PB ≈ **$13k/month**. The exact numbers will differ; the
  **~7× difference from protocol design** is the point to make in an interview.

**Compute:** ~50 WebSocket instances + a few API instances + ingest + managed Redis + managed Postgres. Usually
*smaller* than the bandwidth bill at this scale; autoscaling on connection count keeps it matched to the time of day.

**Other levers.** CDN for static files (cheaper per GB than origin egress, and faster). Lower update rates
(do users need BTC 10×/s or is 1×/s fine? product decides). Managed services trade money for fewer people on-call.

**Interview angle.** *"What dominates your cloud bill at 1M users?"* Egress for the live stream; show the formula and
how batching, encoding and compression cut it. *"How do you keep cost proportional to usage?"* Autoscaling on the
right metric (concurrent connections), CDN offload, and sending less data.
