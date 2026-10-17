# Live Price Tracker — Build Guide

A phase-by-phase guide, written the way a senior engineer would walk a teammate through a project: what to build, why it exists, what decisions are yours to make, and what "done" looks like at each step. You write the code yourself — this is the map, not the code.

---

## The Product, One More Time

**User logs in → adds stocks/crypto to a personal watchlist → sees live prices + a chart per symbol → sets price alerts that fire when a target is hit.**

Four features. Built in three phases, each one upgrading a piece from "fake/simple" to "real/production-style" without touching the others.

| Phase | What's fake | What's real |
|---|---|---|
| 1 | Prices, login | Angular structure, UI, forms, charts |
| 1.5 | — | Auth (real JWT backend) |
| 2 | — | Prices (real WebSocket + Redis feed) |

---

## How to Use This Guide

For every step you'll see:
- **Goal** — the one sentence describing what this step achieves for the product
- **What you're building** — the pieces, named plainly
- **Decisions that are yours** — I'll explain the tradeoff, you pick, and ideally write down *why* in a short decision log (template at the bottom) — this is what makes the project defensible in an interview later
- **Concepts this teaches** — tie back to your Angular/FastAPI deep-dive list
- **How you'll know it's done** — a concrete, checkable thing, not a vague feeling

Don't read the whole guide and try to hold it all in your head. Read one step, build it, verify it, *then* read the next step. That's the whole point of breaking it up this way.

---

# PHASE 1 — Angular Frontend (Fake Data)

Goal of this entire phase: a fully working, good-looking app where everything *works*, but the "live" prices come from your own browser, not a server.

## Step 1 — Skeleton

**Goal:** a running Angular app with two pages and nothing dynamic yet.

**What you're building:**
- A new Angular project, generated with standalone components (no NgModules at all — you'll pass a flag for this when generating the project; look up the current Angular CLI flag for a standalone-only app)
- Two routes: `/watchlist` and `/portfolio`
- A simple nav bar to switch between them
- Each page just shows a hardcoded heading for now — "Watchlist" / "Portfolio" — no real data

**Decisions that are yours:**
- Folder structure — a common approach is a `core/` folder (services, guards, interceptors used app-wide) and a `features/` folder (one subfolder per page/feature: `watchlist/`, `portfolio/`, `auth/`). Decide this now; restructuring later is annoying.
- Styling approach — Tailwind (you already know it from your day job) or plain CSS. Given your existing skill, Tailwind is the lower-friction choice, but it's your call.

**Concepts this teaches:** Angular's standalone component model, routing setup (`provideRouter`), basic project structure decisions.

**Done when:** you can navigate between `/watchlist` and `/portfolio` in the browser, both render something, no console errors.

---

## Step 2 — Fake Price Feed (RxJS)

**Goal:** a service that produces fake, continuously-changing prices for a set of symbols, that any component can subscribe to.

**What you're building:**
- A `PriceService` (or similar) that holds a small hardcoded list of symbols (e.g. `RELIANCE`, `TCS`, `BTC`, `ETH`) with a starting price each
- Inside the service, an RxJS `interval` (e.g. every 1-2 seconds) that nudges each price up or down by a small random amount — a "random walk," which is the standard way to fake realistic-looking price movement
- The service exposes this as a stream components can subscribe to

**Decisions that are yours:**
- How to store "current state of all prices" — a plain `Map`/object the interval mutates, or a more structured approach. Either works; the point is you choose and can explain why.
- How often prices tick — faster feels more "live" but is more noise to look at. Pick something, you can always change it.
- Whether the random walk should have any bias (e.g. slight upward drift) or be pure random — doesn't matter for learning, but deciding and justifying it is good practice for the "why" habit you've been building.

**Concepts this teaches:** RxJS `interval`, the service-as-single-source-of-truth pattern, how a stream of changing data gets produced in the first place (this is the piece Phase 2 will later replace with a real feed — notice *what exactly* gets swapped out when you get there).

**Done when:** you can log the price stream to the console and watch numbers change every tick, for every symbol, without manually triggering anything.

---

## Step 3 — Signals-Based State + Display

**Goal:** the watchlist page actually displays live-updating prices on screen, efficiently.

**What you're building:**
- Convert your `PriceService`'s internal state to Angular **signals** — each symbol's price becomes a signal, or you hold one signal containing the whole price map
- A `computed()` signal that derives something from the raw prices — e.g. "gainers" (price went up since you started watching) vs "losers" — this is a good forcing function to actually use `computed()`, not just `signal()`
- The watchlist component reads these signals directly in its template — no manual subscribe/unsubscribe needed, which is exactly why signals are nice for this
- Set the watchlist component's change detection to `OnPush`

**Decisions that are yours:**
- Where the signals live — directly in the service (common, simple) vs. a separate "store" class. For a project this size, signals in the service is reasonable; don't over-engineer this yet.
- What exactly counts as a "gainer" — compared to the previous tick, or compared to when you first opened the page? Either is defensible, pick one and know why.

**Concepts this teaches:** `signal()`, `computed()`, how signals interact with `OnPush` change detection (this is the current, modern Angular reactivity model — important to actually understand, not just use).

**Done when:** prices visibly tick up/down on screen in real time, with zero manual subscription code in your component, and you can point to exactly where `OnPush` is set and explain why it's safe to use here.

---

## Step 4 — Chart Per Symbol

**Goal:** clicking a symbol in your watchlist shows a live-updating price chart for it.

**What you're building:**
- Install `lightweight-charts` (TradingView's own open-source charting library)
- A chart component that takes a symbol as input, and feeds it a running history of that symbol's prices (you'll need to start keeping a short price history array per symbol in your service now, not just the latest price)
- Wire it so selecting a symbol in the watchlist shows its chart

**Decisions that are yours:**
- How much history to keep per symbol (last 50 points? last 5 minutes?) — this is a real memory-vs-usefulness tradeoff, same shape as decisions you make in production
- Line chart vs candlestick — line is simpler to start with given you're generating raw price ticks, not open/high/low/close bars; candlesticks are a good stretch goal later if you want to simulate OHLC data instead

**Concepts this teaches:** integrating a third-party library into a standalone Angular component, feeding a UI component a continuously-updating data series (this is good practice for later feeding it *real* data in Phase 2 — the component shouldn't need to know or care where the numbers come from).

**Done when:** selecting a symbol shows a chart that visibly grows/updates as new fake ticks arrive.

---

## Step 5 — Search + Add Symbol

**Goal:** a search box lets the user find and add a new symbol to their watchlist.

**What you're building:**
- An input box with a small hardcoded "universe" of searchable symbols (bigger than your watchlist's starting list — e.g. 20-30 fake symbols to search through)
- As the user types, filter/suggest matches and let them add one to the watchlist
- Use `debounceTime` so you're not re-filtering on every single keystroke
- Use `switchMap` to turn the search term into search results

**Decisions that are yours:**
- Debounce delay — 200ms? 300ms? Try a couple, see what feels responsive without being noisy.
- What happens if they search for something not in your fake universe — show "no results," and decide if that's good enough or if you want a friendlier empty state.

**A deliberate exercise, not optional:** build it correctly with `switchMap` first, confirm it works. Then temporarily swap in `mergeMap` instead, type a search term fast, and actually watch what breaks (older, slower-to-resolve searches overwriting newer ones, or results appearing out of order). Then switch back to `switchMap`. This single exercise is worth more than reading ten explanations of the difference.

**Concepts this teaches:** `debounceTime`, `switchMap` vs `mergeMap` and *why* the difference matters, not just that it exists.

**Done when:** you can search, add a new symbol to the watchlist, see it start ticking immediately, and you've personally watched the `mergeMap` bug happen and understood why.

---

## Step 6 — Price Alerts

**Goal:** the user can set a target price for a symbol, and gets notified when it's crossed.

**What you're building:**
- A small form (per symbol) to set an alert: target price, and direction (alert when price goes *above* or *below* this value)
- A **Reactive Form** with a custom validator — e.g. the target price can't be exactly equal to the current price (that would fire instantly / be meaningless)
- Somewhere in your price-update logic, check active alerts against the latest price each tick; when crossed, show a visible notification (a toast, or even just a styled banner — doesn't need to be fancy) and deactivate that alert so it doesn't fire repeatedly

**Decisions that are yours:**
- Where alert-checking logic lives — inside `PriceService` itself (checks alerts every tick as part of updating prices) vs a separate `AlertService` that watches the price signals. The separate-service approach is cleaner/more realistic — worth trying even though it's slightly more setup.
- What happens after an alert fires — does it just deactivate, or can the user re-arm it? Your call.

**Concepts this teaches:** Reactive Forms, writing a custom validator function, connecting form state to ongoing stream data (this is a nice forcing function for combining what you learned in Steps 2-3 with form handling).

**Done when:** you can set an alert, watch the fake price stream eventually cross it, and see a real notification fire exactly once.

---

## Step 7 — Scale Test

**Goal:** confirm your app stays smooth even with a large watchlist, and *prove* to yourself that your optimizations are doing something (not just trusting that they help).

**What you're building:**
- Temporarily generate 150-200 fake symbols instead of 4-5
- Add CDK virtual scrolling to the watchlist list so only visible rows are actually rendered
- Open your browser's dev tools performance/rendering panel, and actually compare rendering behavior with virtual scrolling on vs. off

**Decisions that are yours:**
- None, really — this step is about *verifying*, not deciding. The only thing worth deciding is how you want to measure the difference (dev tools timeline, simple FPS counter, or just visually judging scroll smoothness).

**Concepts this teaches:** CDK virtual scrolling, and — more importantly — the habit of actually confirming a performance claim instead of assuming it. Also a last confirmation that your earlier `trackBy` + `OnPush` choices are paying off, now that there's enough data for it to matter.

**Done when:** you can describe, with an actual before/after observation (not a guess), what virtual scrolling changed.

---

# PHASE 1.5 — Custom Auth (Real Backend, Small Scope)

Goal of this phase: replace "anyone can see the portfolio page" with real login, matching the JWT pattern you already built once in production — this time, build it from your own understanding, not by copying old code.

## Step 1 — FastAPI Auth Backend

**Goal:** a small backend service that can register a user, log them in, and issue tokens.

**What you're building:**
- A minimal FastAPI app (this can be its *own* small project/folder, separate from the Angular app, talking over HTTP)
- A `users` table (even SQLite is fine here — you don't need Postgres for a side project this size) with hashed passwords (never store plain text — use `passlib` or similar)
- `/register` and `/login` endpoints
- On successful login: issue a short-lived **access token** (JWT) and a longer-lived **refresh token**
- A `/refresh` endpoint that trades a valid refresh token for a new access token
- Single-session-per-device enforcement: store the current valid refresh token (or a session ID) per user in the DB; on a new login, invalidate the previous one

**Decisions that are yours:**
- Where to store the refresh token on issue — a `sessions` table (session ID, user ID, token hash, device info) is the cleaner version of what you did in your real POC; a single column on the `users` table is a simpler shortcut if you want to move faster first and refactor later
- Access token lifetime (e.g. 15 min) vs refresh token lifetime (e.g. 7 days) — there's no single right number; the tradeoff is security (shorter = safer if leaked) vs user annoyance (shorter = more frequent silent refreshes)

**Concepts this teaches:** password hashing, JWT issuing/verifying, the access/refresh token pattern, session invalidation logic — all things you've touched in production, now built from scratch by you.

**Done when:** using a tool like `curl` or Postman (not the Angular app yet), you can register, log in, get back two tokens, and use the refresh token to get a new access token.

---

## Step 2 — Angular Auth Integration

**Goal:** the Angular app actually requires login, and the portfolio page is genuinely protected.

**What you're building:**
- A login page/form (Reactive Form again — more practice)
- An `AuthService` that calls your FastAPI backend, stores the access token (decide where — see below), and exposes "is logged in" as a signal
- An **HTTP interceptor** that attaches the access token to outgoing requests, and — this is the interesting part — catches a 401 response, calls `/refresh` automatically, and retries the original request once
- A **route guard** on `/portfolio` that checks the auth signal and redirects to login if not authenticated

**Decisions that are yours — and these are genuinely debatable, be ready to defend your choice:**
- **Where to store the access token:** an httpOnly cookie (can't be read by JavaScript, safer against XSS, but needs the backend to set it and needs CORS/cookie config handled correctly) vs. in-memory in your Angular service (gone on page refresh, forcing a silent-refresh-on-load flow, but immune to a different class of attack) vs. `localStorage` (simplest to implement, but the one most commonly flagged as a security weak point in interviews — if you pick this, at least be ready to explain the tradeoff honestly rather than pretending it's risk-free)
- Whether the refresh token ever touches the frontend at all, or stays purely in an httpOnly cookie the browser sends automatically — the more production-realistic answer is the latter

**Concepts this teaches:** the full access/refresh token lifecycle from the client side, HTTP interceptors, route guards, and a genuinely important security tradeoff conversation you'll be able to speak to confidently in an interview because you made the call yourself.

**Done when:** you can log in through the actual UI, get redirected away from `/portfolio` if not logged in, and — the real test — let your access token expire (set it to something short like 30 seconds while testing) and confirm the app silently refreshes it without logging you out or showing an error.

---

# PHASE 2 — Real Backend (Live Data + Fan-Out)

Goal of this phase: replace the fake RxJS price generator with a real WebSocket feed, broadcast efficiently to multiple connected clients via Redis — this is the actual system-design lesson of the whole project.

## Step 1 — FastAPI WebSocket Server

**Goal:** a backend endpoint clients can open a persistent connection to and receive live price pushes.

**What you're building:**
- A WebSocket endpoint in your FastAPI app (same backend as your auth, or a separate service — your call, see below)
- When a client connects, it gets added to a list of "connected clients for symbol X"
- When new price data is available, the server pushes it down every connected socket for that symbol

**Decisions that are yours:**
- Same FastAPI app as auth, or a separate service — running it all in one app is simpler for a side project; splitting it is more "real," but adds deployment complexity you may not want yet. Simpler is a defensible choice here — just know *why* you chose it (project scope, not production scale).
- How you track "who's connected to what" — a plain in-memory dictionary is fine at this scale (and is honestly how many production systems start), just know this wouldn't survive a server restart or multiple server instances — which is exactly the problem Redis solves at step 2-3.

**Concepts this teaches:** WebSocket server basics in FastAPI, the idea of a connection registry, push-based (not request-based) communication.

**Done when:** using a simple WebSocket test client (there are free browser extensions/tools for this), you can connect and receive pushed messages without polling.

---

## Step 2 — Connect to a Real Data Source (Binance)

**Goal:** your server has genuinely real, live price data to push, not fake numbers.

**What you're building:**
- Your FastAPI backend opens its *own* WebSocket connection to Binance's free public stream for a few symbols (e.g. BTC/USDT, ETH/USDT)
- As ticks arrive from Binance, your server processes them and prepares to broadcast

**Decisions that are yours:**
- Which symbols to support (keep it small — 5-10 is plenty for this project)
- Whether to pass through raw tick data, or do any light processing first (e.g. rounding, or computing a simple percentage change) before broadcasting

**Concepts this teaches:** your backend as *both* a WebSocket client (to Binance) and a WebSocket server (to your own Angular app) at the same time — a genuinely common real-world pattern, worth understanding clearly as two separate roles your one service is playing.

**Done when:** you can log real, live BTC/ETH prices arriving from Binance into your server's console.

---

## Step 3 — Redis Pub-Sub Fan-Out

**Goal:** the actual point of this whole project — broadcast efficiently to many clients without each one separately hitting Binance or overloading your server loop.

**What you're building:**
- A Redis instance (local, via Docker is easiest) running alongside your backend
- When your server receives a tick from Binance, it **publishes** it to a Redis channel (e.g. `prices:BTC`)
- Any number of connected WebSocket clients **subscribe** to that same channel and immediately get forwarded whatever arrives
- This decouples "fetching from Binance" (happens once, no matter how many users you have) from "delivering to users" (happens N times, once per connected client) — this is the exact concept your roadmap's Phase 3 calls "pub-sub fan-out," now built with your own hands instead of just read about

**Decisions that are yours:**
- One Redis channel per symbol, or one channel with symbol as part of the message payload — both are valid; one-channel-per-symbol is slightly simpler to reason about at this scale
- What happens to a client if Redis itself goes down — not something you need to solve robustly for a side project, but worth being able to *say* what you'd do (e.g. fallback to direct in-memory broadcast, or just accept downtime for a project this size) — naming the gap honestly is itself a sign of maturity in an interview

**Concepts this teaches:** pub-sub as a pattern (one publisher, many subscribers, fully decoupled), why this solves the "500 people watching the same stock" scaling problem, hands-on Redis usage.

**Done when:** you can open your Angular app in two different browser tabs, both logged in, both watching BTC, and confirm (e.g. by temporarily logging in your backend) that Binance was only queried **once**, while both tabs received the update.

---

## Step 4 — Angular WebSocket Client + Reconnection

**Goal:** the Angular app connects to your real backend instead of its old fake `interval`, and survives a dropped connection gracefully.

**What you're building:**
- Replace the internals of your `PriceService` — the *interface* it exposes to the rest of the app should ideally stay the same (this is the payoff of Step 3 in Phase 1: your chart/watchlist components shouldn't need to change at all, only what feeds the service changes)
- Open a native WebSocket (or use RxJS's `webSocket` helper) to your FastAPI endpoint from Step 1
- Handle disconnection: detect it, attempt to reconnect (with a short delay, and ideally a backoff if it keeps failing), and resubscribe to whatever symbols the user had open

**Decisions that are yours:**
- Reconnect delay/backoff strategy — fixed delay (e.g. retry every 3 seconds) is simplest; exponential backoff (wait longer each failed attempt) is more realistic for production but added complexity — pick based on how much you want to practice this specific pattern
- Whether to show the user any "reconnecting..." UI state, or handle it silently

**Concepts this teaches:** real-world WebSocket client lifecycle management — this is a genuinely common interview topic ("how do you handle a dropped WebSocket connection?") that most candidates can only answer in theory; you'll have actually built it.

**Done when:** with the app open and receiving real live prices, you manually kill your backend server, watch the app detect the drop, then restart the backend and watch the app reconnect and resume updates without a page refresh.

---

## Step 5 — Final Verification

**Goal:** confirm the whole thing genuinely holds together end to end.

Checklist to walk through yourself:
- [ ] Fresh browser, not logged in → redirected away from `/portfolio`
- [ ] Register a new user, log in, land on `/watchlist`
- [ ] Search and add a real symbol (BTC/ETH)
- [ ] See its chart update with genuinely live data
- [ ] Set an alert, watch it fire when crossed
- [ ] Open a second browser tab, confirm both update together and your backend only hit Binance once
- [ ] Kill and restart your backend, confirm the frontend reconnects
- [ ] Let your access token expire, confirm silent refresh keeps you logged in

If all of these pass, you've genuinely built — and can explain — the full thing: a custom-auth, real-time, fan-out-architected live price tracker. That's a legitimately strong project to walk an interviewer through.

---

## Decision Log (keep this as you go)

For every "Decisions that are yours" moment above, jot one line here. This becomes your interview prep material — these are the exact things an interviewer will probe.

```
Step: 
Decision: 
Why I chose it: 
What I'd reconsider at larger scale: 
```

---

## Reminder on Pace

This is a multi-week project done alongside DSA, not a weekend sprint. One step at a time, verify each "Done when" before moving on, and it's completely fine for a step to take longer than it "should" — the goal is actually understanding each piece, not finishing fast.
