# Module 8: Real-World Features (what companies actually build)

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 7](module-7-scale.md)

Fancy screens are easy to make. What shows real engineering is finding a **real problem**, fixing it,
and **proving** it works. Each part of this module does exactly that, in plain words:

| Part | The problem | What we built |
|---|---|---|
| 8.1 | Alerts only worked while the tab was open | Alerts saved and checked **on the server** |
| 8.2 | Nobody knew how fast prices reach the screen | **Latency tracing**: time measured at every step |
| 8.3 | The "it can handle X users" numbers were guesses | A **load test** + the slow-client fix, measured before and after |
| 8.4 | Nothing checked the code automatically | A **CI pipeline** that tests every push |

---

## 8.1 Server-side price alerts

### The problem (in one sentence)
Before this change, your alerts lived **only in the browser tab's memory**: close the tab and they never fired;
reload the page and they were gone. A price-alert app that only works while you stare at it is broken.

### What it is (analogy)
Old way: you sit by the window watching the street for a delivery van. If you go to sleep, you miss it.
New way: you tell the **security guard at the gate** (the server) "call me when the van arrives". The guard
watches all day, writes it in the logbook when it happens, and rings your phone if you're reachable.

### How it works, step by step
```
1. You set an alert   ──POST /api/alerts──►  saved in the database ("alerts" table, status = active)
2. A price arrives    ──Redis──►  AlertEngine (on the server) checks the alerts for that symbol
3. Price crossed it?  ──►  database: status active → triggered   (happens exactly ONCE)
4. Tell the user      ──Redis "alerts:user:7"──► the hub ──► your open browser tab(s) ──► toast
5. Tab closed?        ──► nothing lost: next time you open the app, it loads the alert as "✓ fired"
```

**1. Saving the alert.** The alert panel sends it to the server
[alerts.py:L63](../../backend/app/routers/alerts.py#L63). The server first checks it isn't already true
(e.g. "above ₹100" while the price is ₹120 would fire instantly, which is almost always a mistake)
[alerts.py:L67-L76](../../backend/app/routers/alerts.py#L67-L76).
The table is defined in [models.py:L44-L57](../../backend/app/models.py#L44-L57).

**2. Watching prices.** The `AlertEngine` listens to the same Redis price channels as the WebSocket hub
[alerts_engine.py:L76-L88](../../backend/app/realtime/alerts_engine.py#L76-L88). To stay fast it keeps the active
alerts **in memory**, grouped by symbol, so a price tick needs **no database query**. It reloads that list when
someone creates or cancels an alert (a message on the `alerts:changed` channel).

**3. Firing exactly once.** This is the clever bit. Imagine two servers running (for scale): both see the same
tick and both want to fire the same alert, so you'd get **two** notifications. The fix is one database
command [alerts_engine.py:L49-L58](../../backend/app/realtime/alerts_engine.py#L49-L58):
```sql
UPDATE alerts SET status = 'triggered' WHERE id = 42 AND status = 'active'
```
The database lets only **one** of them change the row (the second finds it's no longer `active`, so 0 rows
change). Only the server whose update changed 1 row sends the notification. This idea, "make doing it twice
harmless", is called **idempotency**. We tested it: 5 attempts at the same moment → exactly 1 succeeded.

**4. Delivering to the right person.** Prices are public, but *your* alerts are private. So after connecting,
the browser sends its access token over the WebSocket [ws.py:L66-L71](../../backend/app/routers/ws.py#L66-L71)
(in a message, not in the URL, because URLs get written into server logs). The hub remembers which socket
belongs to which user [hub.py:L40-L47](../../backend/app/realtime/hub.py#L40-L47), and sends the alert only to that user's
sockets (all of their open tabs).

**5. The browser side.** `AlertService` no longer checks prices at all. It loads your alerts when you log in,
gives the live connection your token, and shows a toast when the server says "fired"
[alert.service.ts:L109-L130](../../frontend/src/app/core/services/alert.service.ts#L109-L130). If the tab is in the
background and you allowed it, it also shows a **desktop notification** (the Windows popup)
[alert.service.ts:L199-L205](../../frontend/src/app/core/services/alert.service.ts#L199-L205).

### Why we chose this design
| Option | Why not |
|---|---|
| Keep checking in the browser | Only works while the tab is open, which was the bug |
| Query the database on every tick | ~25 ticks/s × all alerts = lots of DB work for nothing. In-memory index instead |
| Fire without the "only if still active" check | Duplicate notifications as soon as you run 2 servers |
| Put the token in the WebSocket URL (`?token=…`) | URLs end up in logs; a message doesn't |

### How it helps
- Alerts survive closed tabs, reloads and switching computers (they're tied to your account, not your browser).
- You see what fired while you were away ("✓ fired Oct 20, 11:41").
- Mistaken alerts that would fire instantly are blocked, in the form **and** on the server (Backlog #5 fixed).

### Honest limits (say these in an interview, it shows maturity)
- **You must be logged in** to use alerts now (the server needs to know whose alert it is).
- **Fully closed browser = no popup yet.** The alert still fires and is saved, and you see it next time. A popup
  with *no* tab open needs **Web Push** (a Service Worker + the browser vendor's push service). That's the
  natural next step.
- The engine checks alerts with a simple loop per symbol. Fine for thousands of alerts; for millions see below.

### At large scale
- **Millions of alerts:** keep each symbol's alerts **sorted by target price**. When the price rises to X, only
  the "above" alerts with target ≤ X can fire, and they're all at the start of the list, so you check a handful
  instead of all of them.
- **Many servers:** today every server's engine checks every alert; the `WHERE status='active'` trick stops
  duplicates, but the work is repeated. At scale you'd **shard**: server 1 handles symbols A–M, server 2 N–Z.
- **Notifications:** push delivery becomes its own service with a **queue** (retry if the phone is offline,
  rate-limit so a crash in the market doesn't send someone 500 popups).

### Interview angle
- *"How do you make sure an alert fires exactly once with several servers?"* A conditional update
  (`WHERE status='active'`); only the one that changed the row notifies. That's idempotency.
- *"Why not just check in the frontend?"* The frontend isn't running when the user isn't looking. Anything
  that must happen "while you're away" belongs on the server.
- *"How does the server know which WebSocket belongs to which user?"* The client sends its access token as the
  first message; the server verifies it and keeps a user → sockets map.
- *"What would you add next?"* Web Push for fully closed browsers, plus a notification queue with retries.

**How to see it yourself:** log in, select TCS, set "Above" slightly over the current price, then close the tab.
Wait until the price passes it (or ask me to send a test tick), reopen the app: the alert shows as "✓ fired".
Re-run the server checks any time: `cd backend` → `python tests/e2e_alerts.py` (backend must be running).

---

## 8.2 Latency tracing: how fast do prices reach the screen?

### The problem
"It's real-time" is a claim. Real-time *how*? 50 ms? 3 seconds? Before this, nobody could answer.
In trading, **speed is the product**, so every serious team measures it continuously.

### What it is (analogy)
A courier parcel with a tracking page: *picked up 10:00 · arrived at hub 10:40 · out for delivery 11:05 ·
delivered 11:30*. When a parcel is late, the timestamps show **which leg** was slow. We do the same for each price.

### How it works, step by step
```
Binance ─①─► our server ─②─► leaves our server ─③─► browser receives ─④─► painted on screen
   ts            rx                  tx                  received              painted
```
| Step | Measured as | Clocks used | How exact? |
|---|---|---|---|
| ① Exchange → our server | `rx − ts` | Binance's and ours | approximate (two different clocks) |
| ② Inside our server | `tx − rx` | ours only | exact |
| ③ Our server → browser | `received + offset − tx` | server's and browser's | ± half a ping round trip |
| ④ Browser → screen | `painted − received` | browser only | exact |
| **Total we control** | ② + ③ + ④ | | |

- **Stamping:** the backend writes `rx` the moment a Binance message arrives [feeds.py:L50](../../backend/app/realtime/feeds.py#L50)
  and `tx` just before sending to browsers [hub.py:L74](../../backend/app/realtime/hub.py#L74). The
  browser writes `received` as soon as the message arrives [websocket-price-feed.ts:L92](../../frontend/src/app/core/services/websocket-price-feed.ts#L92).
- **Painted:** after Angular updates the page, we wait for the browser's next paint and note the time
  [app.ts:L50-L53](../../frontend/src/app/app.ts#L50-L53).
- **The clock problem (and the fix).** Your PC's clock and the server's clock never agree exactly (remember the
  Google login bug!). Subtracting times from two clocks is wrong by however far apart they are. So every 10 s the
  browser sends `ping` with its time `t0`, the server answers with its time, and the reply arrives at `t1`:
  ```
  offset ≈ server_time − (t0 + t1) / 2        accurate to ± (t1 − t0) / 2
  ```
  (the server read its clock about halfway through the round trip). This is **Cristian's algorithm**, a simple
  cousin of how NTP keeps every computer's clock right [websocket-price-feed.ts:L117-L122](../../frontend/src/app/core/services/websocket-price-feed.ts#L117-L122).
- **Percentiles, not averages:** the service keeps the last 600 measurements per step and computes p50/p95/p99
  once a second [latency.service.ts:L47-L51](../../frontend/src/app/core/services/latency.service.ts#L47-L51).
  "p95 = 338 ms" means 95 % of ticks were faster than 338 ms. Averages hide the slow cases users actually notice:
  one 10-second hiccup among 99 fast ticks pushes the average to ~150 ms, a number no tick ever had (there's a
  unit test that shows exactly this).

### What we measured (this PC, live Binance feed, 75 s, 285 ticks)
| Step | p50 | p95 | p99 |
|---|---|---|---|
| Exchange → our server | 1,354 | 1,366 | 1,371 |
| Inside our server (Redis) | **2** | 6 | 13 |
| Our server → browser | **2** | 56 | 60 |
| Browser → on screen | **272** | 285 | 290 |
| **Our server → on screen** | **281** | 338 | 343 |

**What the numbers tell us (this is the interesting part):**
1. **Our server and Redis are fast:** 2 ms typical. Not where to optimise.
2. **The network is fast** locally (2 ms); the 56 ms p95 is the occasional busy moment.
3. **~250 of our 281 ms is our own batching.** `auditTime(250)` (Module 2.5) deliberately waits up to 250 ms to
   group ticks into one screen update. It saves CPU (Step 7), but now we *know* its price in latency. Lowering it
   to ~50–100 ms, or batching per animation frame (~16 ms), would cut the total to well under 100 ms at the cost of
   more renders per second. **That's a trade-off to decide with these numbers, not a guess.**
4. **"Exchange → us" ≈ 1.35 s** is mostly outside our control: Binance's `miniTicker` stream is itself **sent once
   per second** (so a price can be up to ~1 s old when it's sent), plus any difference between Binance's clock and this
   PC's clock, which we can't measure. A trading firm would use Binance's faster `trade` stream and keep its servers'
   clocks synced with NTP.

### Why we chose this design
| Option | Why not (for now) |
|---|---|
| Average latency | Hides the slow tail; percentiles are the industry standard |
| OpenTelemetry + Jaeger/Grafana | The proper tool at scale, but 3 extra services to run; this teaches the idea with zero new dependencies |
| Timing every tick on the server only | Misses the network and the browser, where most of the time turned out to be |

### How it helps
- You can answer "how real-time is it?" with numbers, per step.
- It found a real, fixable cost (our batching) in a place nobody would have guessed.

### At large scale
- Export the same numbers as **metrics** (Prometheus histograms) from every server and every browser (sampled,
  e.g. 1 % of users), and draw p50/p95/p99 over time in **Grafana** with an **alert** when p99 crosses a limit.
- Use **distributed tracing** (OpenTelemetry): every tick carries a trace id through each service, the same idea as
  our `ts/rx/tx` fields, standardised.
- Keep server clocks in sync with NTP (or PTP for microsecond accuracy in trading).
- Define an **SLO**, e.g. "99 % of ticks on screen within 500 ms of reaching us", and alert on it.

### Interview angle
- *"Why p95/p99 instead of the average?"* Users feel the slow tail; averages hide it (and get dragged by outliers).
- *"How do you measure latency between two machines with different clocks?"* Estimate the offset with a
  round-trip ping (Cristian's algorithm / NTP); the error is at most half the round trip.
- *"Where does the time go in your system?"* Use the table: server 2 ms, network 2 ms, our UI batching ~250 ms by
  design, exchange feed ~1 s (its own 1-second updates).
- *"What would you change?"* Lower or frame-based batching, measured before and after; a faster upstream stream.

**See it yourself:** run the app with the live backend and click **⏱** in the header.

---

## 8.3 Load testing, and fixing slow clients

### The problem
Module 7 said things like "~20,000 connections per server". Those were **estimates**. And Backlog #21 said "one
slow client delays everyone", also unproven. An interviewer will ask: *"How do you know?"*

### What it is (analogy)
A restaurant can claim "we serve 200 people an hour". A load test is inviting 200 hungry friends at once and
timing it. It shows the real number **and** where it breaks: the kitchen? the cashier? the door?

### The tool
`tools/loadtest/ws_load.py` (no new dependencies) opens hundreds or thousands of WebSocket clients from one
script and measures how late each price arrives, as percentiles (8.2). Two scenarios:
- **slow**: 50 normal clients + 5 "slow" clients (they stop reading, like a phone on bad mobile data) while the
  tool floods one symbol with ~1 KB ticks at 50 or 200 per second
  [ws_load.py:L141](../../tools/loadtest/ws_load.py#L141).
- **capacity**: N clients arrive at R per second and stay subscribed to 5 symbols
  [ws_load.py:L123](../../tools/loadtest/ws_load.py#L123).

### Finding 1: one slow client really did slow everyone down
The old hub sent each price to every socket and **waited for all of them** before moving on. If one socket
couldn't take more data, everyone waited.

### The fix: an outbox per client, with conflation
```
before:  Redis ─► hub ─► send to A … wait … send to B … wait … send to C (slow!) … everyone waits
after:   Redis ─► hub ─► drop into A's outbox, B's outbox, C's outbox   (instant, never waits)
                         each outbox has its own sender task: A and B send at full speed, C at its own pace
```
[client.py:L32-L46](../../backend/app/realtime/client.py#L32-L46)
- **Conflation:** a waiting BTC price is *replaced* by a newer BTC price, so a slow client gets fewer, but always
  current, prices, and its outbox can never grow beyond one price per symbol. For prices that's correct: an old
  price is worthless once a newer one exists. (For chat messages it would be wrong; every message matters.)
- **Eviction:** a client that can't take a single message for 10 s is disconnected; its browser reconnects by
  itself with backoff (5.2) and gets fresh snapshots.
- The hub's broadcast is now plain, non-waiting code [hub.py:L79-L84](../../backend/app/realtime/hub.py#L79-L84).

### Results: before vs after (same tests, same laptop)
| Scenario | Before p95 / p99 | After p95 / p99 |
|---|---|---|
| 50 msg/s, 50 clients | 24 / 36 ms | 20 / 27 ms |
| 50 msg/s, **+ 5 slow clients** | 94 / **266 ms** | 24 / **36 ms** |
| 200 msg/s (overload), 50 clients | 9,913 / **10,147 ms** | 38 / **65 ms** |
| 200 msg/s, + 5 slow clients | 8,081 / 8,491 ms | 34 / 56 ms |

- Slow clients no longer affect anyone else (the 5 slow ones were disconnected after 10 s, as designed).
- **Overload changed from "prices 10 seconds late" to "prices 11 ms late".** The cost: under overload each client
  received about a third of the individual ticks (the rest were replaced by newer ones before they could be
  sent). Every price they saw was fresh. For a price screen, fresh beats complete.

### Finding 2: what one process really handles (capacity)
| Clients | Arrival rate | Connected | p50 | p95 | p99 | Backend memory |
|---|---|---|---|---|---|---|
| 1,000 | 25 / s | 997 | 87 ms | 217 ms | 309 ms | ~180 KB per client |
| 1,000 | 10 / s | 1,000 | 99 ms | 396 ms | 1,028 ms | 391 MB total |
| 500–3,000 | 100 / s | only ~270–330 | | | | refused: `WinError 1225` |

- **Arriving too fast gets connections refused.** Each new subscriber triggers 5 snapshots (up to 300 history points
  each, ~37 KB). During a burst the single Python thread is so busy building them that it can't accept new
  connections quickly enough; Windows' waiting line for new connections (the *listen backlog*) overflows and the
  rest are refused. That is exactly what a **reconnect storm** after a server restart looks like, and it's why the
  browser waits a random, growing delay before reconnecting (5.2).
- **~1,000 steady clients on one process** with p95 under ~400 ms, on a Windows laptop that also runs the test tool
  and the browser. That's far below Module 7's estimate of ~20k: estimates are where you start, measurements are
  what you trust. A Linux server, several worker processes and a separate machine for the load generator would all
  raise it; that's what you'd test next.

### Why we chose this design
| Option | Why not |
|---|---|
| Keep "send to all and wait" | Proven: one slow client multiplies everyone's p99 by 7 |
| Unlimited queue per client | A stuck client would grow memory forever |
| Drop the oldest message when full | Fine for logs, but for prices "replace with newest" (conflation) is strictly better |
| Locust / k6 | Great tools; ours needs no installs and speaks our exact protocol |

### At large scale
- **Run the load generator on separate machines** (here it shared the CPU, so these numbers are a floor).
- **Lighter snapshots:** send history only for the symbol being charted, or paginate it, so connecting is cheap.
- **More processes / machines** behind a load balancer; **cap the connection rate** per instance and let clients
  retry with jitter.
- **Measure in CI:** run a small load test on every release and fail the build if p95 regresses.
- Same conflation idea is used by real market-data systems ("conflated feeds") for slow consumers.

### Interview angle
- *"What happens when one client is slow?"* Before: everyone waited (p99 ×7). After: per-client outbox + conflation +
  eviction; only that client sees fewer updates.
- *"How many users can one server handle?"* "I measured ~1,000 with p95 < 400 ms on a laptop; connection *rate* broke
  before connection *count*, because each new client costs ~37 KB of snapshot work." Then say what you'd change.
- *"What is conflation?"* Replace an unsent stale value with the newest one. Correct for state (prices), wrong for
  events (orders, messages).

**Run it yourself** (backend + Redis running), from the repo root:
`backend\.venv\Scripts\python tools\loadtest\ws_load.py slow --fast 50 --slow 5 --rate 50`
`backend\.venv\Scripts\python tools\loadtest\ws_load.py capacity --clients 500 --ramp 25`

---

## 8.4 CI: a robot that checks every push

### The problem
All our checks (unit tests, the build, the alert tests, the load test, the doc links) only ran when someone
remembered to run them, on one laptop. Code that "works on my machine" can still be broken for everyone else.

### What it is (analogy)
A quality-control station at the end of a factory line: every product (every push) goes through the same
inspection automatically. If anything fails, the product is marked ❌ and nobody ships it.
**CI** (Continuous Integration) = on every push, a fresh machine installs everything from scratch and runs every check.

### How it works
GitHub reads [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and, on every push to `main` and every pull
request, starts four clean Linux machines **in parallel**:

| Job | What it does | What it catches |
|---|---|---|
| **frontend** | `npm ci` → unit tests (24) → production build | broken code, failing tests, a lock file out of sync with package.json (Backlog #15 can't hide anymore) |
| **backend** | real Redis as a *service container* → start the backend → `tests/e2e_alerts.py` (13 checks) → load test with a **p95 budget** | broken API, alerts not firing or firing twice, **performance regressions** |
| **docs** | `tools/check_doc_links.py` | docs pointing at code that moved or was deleted |
| **docker** | builds both images | Dockerfiles that no longer build |

- The backend job uses `ENABLE_BINANCE=false`: tests must not depend on an outside service being up (they'd fail
  randomly). The simulated stocks still give real ticks to test with.
- **Performance budget:** the slow-client load test fails the build if healthy clients' p95 goes above 500 ms
  [ws_load.py:L157-L159](../../tools/loadtest/ws_load.py#L157-L159). If someone brings back "one slow client slows
  everyone", CI goes red **before** users notice.
- Results appear as ✅/❌ next to each commit on GitHub, and as the badge in the README.

### Why we chose it
| Option | Why not |
|---|---|
| Run checks by hand | People forget, and "my laptop" isn't a clean machine |
| Jenkins / GitLab CI | Fine tools; GitHub Actions is built into where the code already lives, free for public repos |
| One big job | Slower (no parallelism), and you can't see at a glance *what* broke |

### How it helps
Every change is checked the same way, on a clean machine, within minutes. A green ✅ on your GitHub repo also tells an
interviewer you work the way teams do.

### At large scale
- **Branch protection:** `main` only accepts changes whose CI is green (merge via pull request).
- **CD (Continuous Delivery/Deployment):** after CI passes, build the Docker images once, push them to a registry,
  deploy to staging automatically, then production (Module 6).
- Cache dependencies (already done for npm/pip), split slow test suites across machines, run nightly long load tests.

### Interview angle
- *"What does your CI do?"* The four jobs above, including an end-to-end test with real Redis and a **latency budget**.
- *"CI vs CD?"* CI = automatically test every change; CD = automatically ship changes that passed.
- *"Why not call Binance in tests?"* Tests must be deterministic; outside services make them flaky.

**Status:** each step was run locally; the pipeline itself runs the first time this is pushed to GitHub.
