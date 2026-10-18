# Module 2: Angular (the frontend framework)

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 1](module-1-tooling.md) · Next: [Module 3: Backend](module-3-backend.md)

**Why a framework at all?** With plain JavaScript you'd write `document.querySelector(...)` and update text by
hand every time a price changes, for every row, chart and badge, and keep track of what's already on screen.
A framework lets you describe **what the screen should look like for given data**; it does the DOM updates
for you. Angular is one such framework (React and Vue are others).
Deeper notes for every concept: [ANGULAR_FRAMEWORK_GUIDE.md](../ANGULAR_FRAMEWORK_GUIDE.md) (§ numbers below).

---

## 2.1 Components and templates

**What it is.** A **component** is a reusable custom HTML element with its own behaviour, like LEGO bricks.
`<app-watchlist-row>` is one; it contains a price, a name and a flash animation, and you can place 200 of them.

**How it works.** A component = a TypeScript **class** (data and logic) + a **template** (HTML with bindings) +
a **selector** (its tag name) [watchlist-row.ts:L12](../../frontend/src/app/features/watchlist/components/watchlist-row.ts#L12).
Template syntax you'll see everywhere:

| Syntax | Meaning | Plain-JS equivalent |
|---|---|---|
| `{{ stock().price }}` | show a value as text | `el.textContent = …` |
| `[selected]="…"` | set a property / input | `el.selected = …` |
| `(click)="…"` | listen to an event | `el.addEventListener('click', …)` |
| `@if (…) { }` / `@for (…; track …) { }` | conditional / repeated blocks | creating/removing elements by hand |

Components form a **tree**: `App` (header, toasts) → `<router-outlet>` → `Watchlist` (page) →
`WatchlistRow` ×N, `StockChart`, `AlertPanel`. Data flows **down** through inputs
([watchlist-row.ts:L61-L64](../../frontend/src/app/features/watchlist/components/watchlist-row.ts#L61-L64)) and events flow **up**
through outputs (`selectSymbol`). The parent wires them: [watchlist.ts:L153-L158](../../frontend/src/app/features/watchlist/watchlist.ts#L153-L158).
The whole tree starts in [main.ts:L5](../../frontend/src/main.ts#L5).

**Why we chose it.** Splitting the old 551-line watchlist into row + alert panel components (UI R4/R6) made each
piece small enough to read, test and optimise on its own.

**How it helps.** Reuse (one row definition, N rows), and a clear direction of data, so you always know who changes what.

**At large scale.** A shared component library / design system across many apps; "smart" (data-owning) vs
"dumb" (display-only) components so most of the UI is simple and testable.

**Interview angle.** *"How do parent and child components communicate?"* Inputs down, outputs up; for data many
components share, a service with signals (2.2/2.4). See guide §1, §9, §11, §16, §19.

---

## 2.2 Dependency injection (DI) and services

**What it is.** A restaurant cook doesn't build an oven; they ask for "an oven" and the kitchen provides one.
**DI** means a class *asks* for what it needs (`inject(PriceService)`) instead of creating it, and Angular's
**injector** provides it.

**How it works.**
- `@Injectable({ providedIn: 'root' })` [price.service.ts:L25-L27](../../frontend/src/app/core/services/price.service.ts#L25-L27): Angular creates
  **one** shared instance (a *singleton*) the first time someone asks, and gives everyone the same one. That's how
  the watchlist, the chart, the header and alerts all see the **same** prices.
- You can ask for an **abstraction** and let configuration decide the concrete class:
  `PriceFeed` → WebSocket / simulated / no-op [price-feed.provider.ts:L15-L21](../../frontend/src/app/core/services/price-feed.provider.ts#L15-L21).
- Tests replace real dependencies with fakes in one line:
  [price.service.spec.ts:L29](../../frontend/src/app/core/services/price.service.spec.ts#L29).

**Why we chose it.** It's Angular's core mechanism, and it's what made Phase 2 cheap: swapping fake prices for a
live WebSocket changed **zero components**.

**How it helps.** Shared state lives in one place (services), components stay thin, and everything is testable.

**At large scale.** The same idea is behind micro-frontends and plugin systems: code depends on *interfaces*, and
the composition root (our `app.config.ts`) decides implementations per environment (e.g. a mock backend in staging).

**Interview angle.** *"Why DI instead of `new PriceService()`?"* Single shared instance, swappable implementations,
testability. *"Why an abstract class as token?"* TS interfaces vanish at runtime. Guide §5, §10, §23, §30.

---

## 2.3 Change detection, OnPush, zoneless

**What it is.** When data changes, *something* must notice and update the DOM. **Change detection** is Angular
walking the component tree, re-evaluating template bindings, and patching only the DOM parts whose values changed.

**How it works.**
- **Classic Angular** used *zone.js*, which wraps every timer, click and network callback and says "something
  *might* have changed, check everything". Simple, but wasteful with 25 ticks per second.
- **OnPush** [watchlist-row.ts:L58](../../frontend/src/app/features/watchlist/components/watchlist-row.ts#L58):
  "only check me when my inputs change, an event happens inside me, or a signal I read changes".
- **Zoneless** (our app has no zone.js at all): **signals** tell Angular exactly which components need checking,
  and nothing else triggers it.

**Example from our code.** Before Phase 2, the list of tracked symbols was a plain array, not a signal (Backlog #10).
Adding a symbol didn't notify anyone, so the new row only appeared when the *next* price tick happened to trigger a
check, up to 1.5 s later. Making it a signal fixed it [price.service.ts:L35](../../frontend/src/app/core/services/price.service.ts#L35).

**Why we chose it.** A live price app changes data constantly; checking only what changed keeps it smooth.

**How it helps.** With 200 rows, a tick updates only rows whose `stock` input changed; the header, chart and
alert pane aren't re-checked unless their own signals changed.

**At large scale.** The cost of change detection grows with *components × checks per second*. Zoneless + signals + OnPush
keep it proportional to what actually changed, the same idea as React's fine-grained renderers (SolidJS, Preact signals).

**Interview angle.** *"What is zone.js and why go zoneless?"* Auto-detection by patching async APIs vs explicit,
fine-grained notifications through signals. *"When does an OnPush component update?"* Input change (new
reference!), event inside it, a signal it reads, or `async` pipe emission. Guide §2.

---

## 2.4 Signals: `signal`, `computed`, `effect`

**What it is.** A spreadsheet. Cell A1 holds a number (**signal**), B1 = `A1 × 2` (**computed**), and a chart
redraws when B1 changes (**effect**). Change A1 and everything that depends on it updates automatically.

**How it works.**
- `signal(value)`: a box holding a value. Read it by calling it (`selectedSymbol()`), change it with `.set()`/`.update()`.
- When a template, `computed` or `effect` *reads* a signal, Angular records the dependency. On `.set()`, only
  those dependents are marked stale.
- `computed(fn)` is **lazy and memoized**: it recalculates only when read *and* a dependency changed, and it
  notifies its own readers only if the **result** changed (the "equality cut-off", guide §17).
- `effect(fn)` runs side effects (DOM, forms, storage) when dependencies change.

**Example from our code.**
- [watchlist.ts:L224](../../frontend/src/app/features/watchlist/watchlist.ts#L224): which symbol is selected.
- [watchlist.ts:L233-L235](../../frontend/src/app/features/watchlist/watchlist.ts#L233-L235): derived; changes when the
  selection *or* the prices change.
- [watchlist-row.ts:L73-L75](../../frontend/src/app/features/watchlist/components/watchlist-row.ts#L73-L75): the cut-off
  trick, so the currency lookup doesn't re-run on every tick.

**Why signals *and* RxJS?** Signals answer "what is the value **now**?" (state). RxJS answers "what happens **over
time**?" (events: debounce, retry, batching). We use RxJS where time matters and convert to signals for the UI
(`toSignal`) [price.service.ts:L71](../../frontend/src/app/core/services/price.service.ts#L71).

**How it helps.** Fine-grained updates without manual subscribe/unsubscribe in components.

**At large scale.** Derived state stays consistent by construction (no forgotten manual updates). For heavy
derivations over large data, watch out for `computed`s that return new arrays every time (no cut-off).

**Interview angle.** *"computed vs effect?"* Derive values vs perform actions. *"Signals vs Observables?"*
Current state vs streams over time. Guide §8, §17, §20.

---

## 2.5 RxJS: Observables and operators

**What it is.** An **Observable** is a stream of values over time, like a conveyor belt. **Operators** are
workers along the belt that filter, delay, combine or transform items. `subscribe` is standing at the end of
the belt and taking items off.

**How it works.** `source.pipe(op1, op2, …)` builds a new stream. Nothing flows until someone **subscribes**
(*cold*). Unsubscribing stops the work (closes sockets, clears timers).

**Example from our code: four pipelines worth knowing by heart.**
1. **Search box** [watchlist.ts:L258-L264](../../frontend/src/app/features/watchlist/watchlist.ts#L258-L264):
   `debounceTime(300)` waits until typing pauses; `switchMap` cancels the previous search when a new one starts.
2. **Prices** [price.service.ts:L62-L68](../../frontend/src/app/core/services/price.service.ts#L62-L68): `tap` applies every tick,
   `auditTime(250)` batches renders, `map` builds the snapshot, `shareReplay` shares one pipeline with all consumers.
3. **WebSocket reconnect** (guide §26): `retry` with exponential backoff.
4. **Token refresh** (guide §24): `shareReplay(1)` so five simultaneous 401s share **one** refresh request.

**Why we chose it.** Time-based problems (debounce, retry with backoff, batching, cancel the old request) are
one-liners in RxJS and painful by hand.

**How it helps.** Correct behaviour under messy timing: fast typing, flaky networks, bursts of ticks.

**At large scale.** The same stream thinking applies on the backend (Kafka, Redis Streams): events flow through
stages. Watch for **memory leaks**, i.e. subscriptions that are never closed; prefer `toSignal`/`async` pipe, which clean up for you.

**Interview angle.** *"switchMap vs mergeMap vs concatMap vs exhaustMap?"* Cancel previous / run all in parallel /
queue in order / ignore new while busy. *"debounceTime vs auditTime vs throttleTime?"* Wait for silence / last
value per window / first value per window. Guide §6, §7, §26, §27, Step 5 operators.

---

## 2.6 Routing, guards, lazy loading

**What it is.** One HTML page that *acts* like many. The **router** maps the URL to a component and swaps it into
`<router-outlet>` without reloading the page (a *single-page application*, SPA).

**How it works.**
- A route table maps paths to components; `loadComponent: () => import(...)` downloads that page's code only on first visit.
- **Guards** run before entering a route: [app.routes.ts:L13-L16](../../frontend/src/app/app.routes.ts#L13-L16) uses
  [auth.guards.ts:L9-L12](../../frontend/src/app/core/auth/auth.guards.ts#L9-L12) (logged in → allow, else redirect to `/login?returnUrl=…`).
- **Deep links:** if you reload on `/portfolio`, the *server* must still return the app. nginx falls back to
  `index.html` [nginx.conf:L20](../../frontend/nginx.conf#L20) and the router takes over in the browser.

**Why we chose it.** Fast navigation (no full reload), and each page's code loads only when needed.

**How it helps.** The live WebSocket and prices survive navigation between Watchlist and Portfolio, because the page never reloads.

**At large scale.** Route-level code splitting keeps the first load small as features grow; preloading
strategies fetch likely-next pages in the background. Remember: **guards are UX, not security**; the API must
check permissions itself (it does: 401 without a valid token).

**Interview angle.** *"How does an SPA handle a reload on a deep URL?"* Server fallback to `index.html`.
*"Are route guards security?"* No. Guide §3, §4, §25.

---

## 2.7 Forms (reactive, typed, validators)

**What it is.** Forms are where users type data in. Angular's **reactive forms** model the form in TypeScript (a
`FormGroup` of `FormControl`s); the template only binds to it.

**How it works.** Each control holds a value plus state (`touched`, `invalid`, `errors`); **validators** are
functions that return errors or `null`. Typed forms make `form.value` properly typed.

**Example from our code.**
- Alert form [alert-panel.ts:L140-L147](../../frontend/src/app/features/watchlist/components/alert-panel.ts#L140-L147) with a
  custom validator that reads the *live* price through a getter
  [alert-panel.ts:L29-L35](../../frontend/src/app/features/watchlist/components/alert-panel.ts#L29-L35).
- Login form [login.ts:L145-L151](../../frontend/src/app/features/auth/login.ts#L145-L151).
- The search box is a single `FormControl` whose `valueChanges` stream feeds RxJS (2.5).

**Why we chose it.** Validation logic is plain, testable TypeScript; forms combine naturally with streams.
The alternative, *template-driven* forms (`ngModel`), is simpler for tiny forms but harder to test and type.

**How it helps.** Instant feedback (red border, message) without hand-written event handling.

**At large scale.** **Client-side validation is UX; the server must validate again** (ours does with Pydantic
→ 422). Large apps add async validators (e.g. "is this username free?", debounced) and shared validation schemas.

**Interview angle.** *"Reactive vs template-driven forms?"* Model in code vs model in template.
*"Why validate on both sides?"* Anyone can bypass the browser with curl. Step 5 section, guide §18.

---

## 2.8 HTTP, interceptors, `httpResource`

**What it is.** `HttpClient` is Angular's wrapper around `fetch`, returning Observables. **Interceptors** are a
checkpoint every request passes through. `httpResource` exposes an HTTP GET as signals.

**How it works / example.**
- [auth.interceptor.ts:L25](../../frontend/src/app/core/auth/auth.interceptor.ts#L25) adds `Authorization: Bearer …` to `/api/*`;
  on 401 it refreshes once and retries.
- [portfolio.ts:L81](../../frontend/src/app/features/portfolio/portfolio.ts#L81) loads holdings as `value()`, `isLoading()`, `error()`.

**Why we chose it.** Auth handled in **one** place instead of every call site; signals for loading states.

**How it helps.** A page never needs to know about tokens; expiry is invisible to the user.

**At large scale.** Retries with backoff for idempotent GETs, request de-duplication, response caching, and
timeouts, all centralised in interceptors. Guide §24, §28.

**Interview angle.** *"How do you add a token to every request and handle expiry?"* Interceptor + refresh-once-and-retry
+ shared in-flight refresh.

---

## 2.9 SSR, prerender, hydration

**What it is.**
- **CSR** (client-side rendering): the server sends an almost empty HTML page; JavaScript builds everything.
- **Prerender / SSG**: HTML is generated **at build time**.
- **SSR**: HTML is generated **per request** on a Node server.
- **Hydration**: the browser *adopts* the server-made HTML instead of rebuilding it from scratch.

**How it works in our project.** `/watchlist` is prerendered at build time (skeleton rows; no prices exist then),
`/login` and `/portfolio` are client-only because they depend on who's logged in
[app.routes.server.ts:L5-L6](../../frontend/src/app/app.routes.server.ts#L5-L6). Hydration is enabled in
[app.config.ts:L17](../../frontend/src/app/app.config.ts#L17). Code that needs a real browser is guarded: the chart
[stock-chart.ts:L65](../../frontend/src/app/features/watchlist/components/stock-chart.ts#L65) and the price
feed (no sockets on the server) [price-feed.provider.ts:L16](../../frontend/src/app/core/services/price-feed.provider.ts#L16).

**Why we chose it.** The page frame appears immediately, before JavaScript runs. Honest note: the Express SSR
server (`src/server.ts`) isn't used in production; nginx serves static files (Backlog #12).

**How it helps.** Faster first paint and better SEO for public pages.

**At large scale.** Prerendered/static HTML is perfectly cacheable on a CDN, which is ideal. Per-request SSR costs
server CPU for every visitor, so you use it only where content must be fresh *and* indexable.

**Interview angle.** *"SSR vs SSG vs CSR?"* When the HTML is made: per request / at build / in the browser.
*"What is hydration and what breaks it?"* Reusing server DOM; browser-only APIs during server render, or
server/client HTML mismatches. Guide §14, §31.

---

## 2.10 Frontend performance: what we did and why it works

| Technique | Where | What it saves |
|---|---|---|
| `track` in `@for` | [watchlist.ts:L162](../../frontend/src/app/features/watchlist/watchlist.ts#L162) | Rows are **reused**, not destroyed and recreated each tick |
| OnPush + signals + zoneless | 2.3 | Only changed components are checked |
| `computed` cut-off | [watchlist-row.ts:L73-L75](../../frontend/src/app/features/watchlist/components/watchlist-row.ts#L73-L75) | Skips recalculations when the result is equal |
| Batching with `auditTime(250)` | [price.service.ts:L66](../../frontend/src/app/core/services/price.service.ts#L66) | ~25 ticks/s → at most 4 renders/s |
| Virtual scrolling | [watchlist.ts:L148-L152](../../frontend/src/app/features/watchlist/watchlist.ts#L148-L152) | Only visible rows in the DOM: ~3.5× less main-thread work at 205 rows (measured) |
| Lazy routes | 1.3 | Smaller first download |
| Canvas chart | lightweight-charts | Thousands of points without thousands of DOM elements |

**Interview angle.** *"Your app shows 200 live-updating rows. How do you keep it smooth?"* Use the table above,
and add: *"and I measured it"*, with the Step 7 numbers. Guide §21, §27, §29.
