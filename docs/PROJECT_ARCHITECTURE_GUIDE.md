# Live Price Tracker — Project Architecture & Development Guide

> **Purpose of this document:** A comprehensive blueprint of the project's evolution, file organization, structural decisions, and internal data flows. This document allows you to understand how every part of the application works and independently make modifications to any file without relying on external assistance.

---

## 1. Project Overview & Target System Architecture

The **Live Price Tracker** is a full-stack, real-time financial asset monitoring application built across 3 main phases:

```
+-------------------------------------------------------------------------------+
| PHASE 1: Angular Frontend (RxJS Fake Data Walk + Signals + Lightweight Charts)|
|   - Feature-based architecture                                                |
|   - Watchlist & Portfolio pages                                               |
|   - Real-time Signals state management & OnPush rendering                     |
|   - Live chart rendering via lightweight-charts                               |
|   - Debounced stock search & custom Reactive Form price alerts                 |
+-------------------------------------------------------------------------------+
                                       │
                                       ▼
+-------------------------------------------------------------------------------+
| PHASE 1.5: Custom FastAPI Auth Backend (JWT Access & Refresh Tokens)           |
|   - Session invalidation DB tracking                                          |
|   - Angular Auth HTTP Interceptor (automatic 401 token refresh)               |
|   - Route Guard protecting /portfolio                                         |
+-------------------------------------------------------------------------------+
                                       │
                                       ▼
+-------------------------------------------------------------------------------+
| PHASE 2: Production Real-Time Feed & Fan-Out Architecture                      |
|   Binance WS Stream ──► FastAPI Backend ──► Redis Pub/Sub ──► Client WS      |
|   - Pub/Sub fan-out (1 stream to N clients)                                  |
|   - Angular WebSocket client with auto-reconnect backoff                       |
+-------------------------------------------------------------------------------+
```

---

## 2. Directory Structure & Organization Rules

We follow **Feature-First Architecture**, which is the gold standard for enterprise Angular applications:

```
src/app/
├── core/                         # App-wide singletons (Services, Guards, Interceptors)
│   ├── auth/                     # AuthService, authInterceptor, authGuard/guestGuard (Phase 1.5)
│   ├── config/                   # RUNTIME_OPTIONS (?feed=sim, ?scale=N, ?virtual=0)
│   ├── data/                     # Asset universe + scale-test generator
│   ├── models/                   # Shared TypeScript interfaces & types
│   └── services/                 # PriceService, PriceFeed (+ WebSocket / Simulated / Noop), AlertService
│
├── features/                     # Feature domain pages & sub-components
│   ├── watchlist/                # Watchlist feature
│   │   ├── watchlist.ts          # Main watchlist page component
│   │   └── components/           # stock-chart.ts, watchlist-row.ts, alert-panel.ts
│   ├── portfolio/                # Portfolio feature (protected by authGuard)
│   │   └── portfolio.ts          # Portfolio page component
│   └── auth/
│       └── login.ts              # Login + register page
│
├── shared/                       # Reusable UI widgets, pipes, custom directives
├── app.config.ts                 # Global providers (Router, HttpClient, Animations)
├── app.routes.ts                 # Main application routing table
├── app.ts                        # Root layout component (Header + RouterOutlet)
└── app.html                      # Main HTML structure with dark navigation header
```

### Key Structural Decisions & Trade-Offs

1. **Feature-First (`features/`) vs Layer-First (`components/`, `pages/`)**
   - *Why Feature-First:* Grouping files by domain (`watchlist`, `portfolio`) keeps related HTML, TS, CSS, and tests together. If you want to modify the Watchlist page, you only look inside `src/app/features/watchlist/` rather than hunting across multiple global folders.
2. **Standalone Components (`standalone: true`)**
   - *Why:* Eliminates complex `NgModule` files. Every component explicitly declares only what it imports, making code treeshaking cleaner and bundle sizes smaller.
3. **Lazy Route Loading (`loadComponent`)**
   - *Why:* Instead of loading the entire JavaScript bundle upfront, Angular loads separate chunks for `/watchlist` and `/portfolio` on-demand when the user visits the route.

---

## 3. Step-by-Step Development Log

### Step 1: Application Skeleton & Routing Setup

#### Objectives Accomplished:
- Created lazy-loaded feature routes for `/watchlist` and `/portfolio`.
- Built clean placeholder standalone components: `Watchlist` and `Portfolio`.
- Configured root navigation header in `app.html` using Tailwind CSS v4 dark mode styling.

#### File Inventory & Code Walkthrough:

##### A. Routing Table — [`src/app/app.routes.ts`](../frontend/src/app/app.routes.ts)
```typescript
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'watchlist', pathMatch: 'full' },
  {
    path: 'watchlist',
    loadComponent: () =>
      import('./features/watchlist/watchlist').then((m) => m.Watchlist),
  },
  {
    path: 'portfolio',
    loadComponent: () =>
      import('./features/portfolio/portfolio').then((m) => m.Portfolio),
  },
  { path: '**', redirectTo: 'watchlist' },
];
```
- **Line 3:** Redirects root URL `http://localhost:4200/` directly to `/watchlist`.
- **Lines 5–12:** Uses dynamic `import()` to lazy load component bundles on demand.
- **Line 14:** Wildcard fallback redirects unknown paths back to `/watchlist`.

##### B. Watchlist Feature Component — [`src/app/features/watchlist/watchlist.ts`](../frontend/src/app/features/watchlist/watchlist.ts)
```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [],
  template: `
    <div class="p-6 max-w-7xl mx-auto">
      <div class="mb-6">
        <h1 class="text-3xl font-bold tracking-tight text-white">Watchlist</h1>
        <p class="text-slate-400 mt-1">Track real-time prices and market movements.</p>
      </div>

      <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
        <p class="text-lg">Watchlist feature skeleton initialized. Live stream coming next!</p>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {}
```
- **Line 17:** Sets `changeDetection: ChangeDetectionStrategy.OnPush` to prevent unnecessary component re-checks during global Angular change detection cycles.

##### C. Portfolio Feature Component — [`src/app/features/portfolio/portfolio.ts`](../frontend/src/app/features/portfolio/portfolio.ts)
- Standalone component holding the skeleton container for the user's asset holdings.

##### D. Root Layout & Navigation Header — [`src/app/app.ts`](../frontend/src/app/app.ts) & [`src/app/app.html`](../frontend/src/app/app.html)
```typescript
// app.ts
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly title = 'Live Price Tracker';
}
```
- **`app.html`**: Contains top navigation bar with `routerLink="/watchlist"` and `routerLink="/portfolio"`. Active page link receives custom highlight styling via `routerLinkActive`. `<router-outlet />` at the bottom renders the active feature page.

---

### Step 2: Fake Price Feed Service (RxJS & Random Walk)

#### Objectives Accomplished:
- Created strong TypeScript domain model interfaces for asset prices in `src/app/core/models/stock.model.ts`.
- Implemented `PriceService` in `src/app/core/services/price.service.ts` generating real-time continuous asset updates.
- Designed a **Random Walk algorithm** to simulate authentic stock/crypto market fluctuations every 1.5 seconds.
- Exposed the stream as a multicasted RxJS Observable `prices$` using `shareReplay(1)`.

#### File Inventory & Code Walkthrough:

##### A. Asset Domain Interface — [`src/app/core/models/stock.model.ts`](../frontend/src/app/core/models/stock.model.ts)
```typescript
export interface StockPrice {
  symbol: string;         // Unique symbol ticker (e.g. 'BTC', 'RELIANCE')
  name: string;           // Display name (e.g. 'Bitcoin', 'Reliance Industries')
  price: number;          // Current price
  previousPrice: number;  // Price prior to the latest tick (used for flash animations)
  change: number;         // Absolute price difference from initial base price
  changePercent: number;  // Percentage change from initial base price
  updatedAt: Date;        // Timestamp of the latest tick update
}
```

##### B. Price Generator Service — [`src/app/core/services/price.service.ts`](../frontend/src/app/core/services/price.service.ts)
```typescript
@Injectable({ providedIn: 'root' })
export class PriceService {
  private readonly initialAssets: InitialAsset[] = [ ... ];
  private currentPricesMap: Map<string, StockPrice> = new Map();
  readonly prices$: Observable<StockPrice[]>;

  // Signals
  readonly pricesSignal: Signal<StockPrice[]>;
  readonly gainersCount: Signal<number>;
  readonly losersCount: Signal<number>;
  readonly totalTracked: Signal<number>;

  constructor() {
    // 1. Set baseline stock prices
    this.initialAssets.forEach((asset) => { ... });

    // 2. Stream ticks every 1.5 seconds
    this.prices$ = interval(1500).pipe(
      map(() => this.calculateNextPrices()),
      shareReplay(1)
    );

    // 3. Convert RxJS stream to Signal & derive summary state
    this.pricesSignal = toSignal(this.prices$, { initialValue: [] });
    this.gainersCount = computed(() => this.pricesSignal().filter(s => s.change > 0).length);
    this.losersCount = computed(() => this.pricesSignal().filter(s => s.change < 0).length);
    this.totalTracked = computed(() => this.pricesSignal().length);
  }
```

---

### Step 3: Signals-Based State & Live UI Display

#### Objectives Accomplished:
- Converted RxJS price stream into Angular Signals using `toSignal()`.
- Created reactive computed state (`gainersCount`, `losersCount`, `totalTracked`) using `computed()`.
- Connected `Watchlist` UI component ([`src/app/features/watchlist/watchlist.ts`](../frontend/src/app/features/watchlist/watchlist.ts)) to render live ticking price cards.
- Used Angular 19 Control Flow (`@for ... track stock.symbol`) with `OnPush` change detection for max performance.

#### File Inventory & Code Walkthrough:

##### A. Watchlist UI Component — [`src/app/features/watchlist/watchlist.ts`](../frontend/src/app/features/watchlist/watchlist.ts)
```typescript
@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [DatePipe, Skeleton, StockChart],
  template: `
    <!-- Header with Live Feed status -->
    ...
    <!-- Asset Grid with Click Selection -->
    @for (stock of priceService.pricesSignal(); track stock.symbol) {
      <div 
        (click)="selectedSymbol.set(stock.symbol)"
        [class.ring-2]="selectedSymbol() === stock.symbol"
        [class.ring-cyan-400]="selectedSymbol() === stock.symbol">
        ...
      </div>
    }

    <!-- Live TradingView Chart for Selected Symbol -->
    @if (selectedSymbol()) {
      <app-stock-chart [symbol]="selectedSymbol()!" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {
  readonly priceService = inject(PriceService);
  readonly selectedSymbol = signal<string>('BTC');
}
```

---

### Step 4: Live TradingView Chart Per Symbol (`lightweight-charts`)

#### Objectives Accomplished:
- Installed official TradingView `lightweight-charts` library.
- Enhanced `PriceService` with historical data series memory (rolling window of 50 data points).
- Built standalone `StockChart` component ([`src/app/features/watchlist/components/stock-chart.ts`](../frontend/src/app/features/watchlist/components/stock-chart.ts)) using HTML5 Canvas AreaSeries.
- Handled Angular SSR safely using `isPlatformBrowser(platformId)` to prevent server-side DOM errors.
- Synchronized time formatting between the card's `DatePipe` and the chart's `timeScale.tickMarkFormatter` and `localization.timeFormatter` to match the user's local timezone (IST) down to the exact second.
- Connected user selection so clicking any card updates `selectedSymbol` signal and instantly streams live price ticks to the chart.

---

## 4. How to Extend / Modify This Codebase Independently









1. **Adding a New Page/Feature:**
   - Create a new directory inside `src/app/features/my-feature/my-feature.ts`.
   - Add a path object in `src/app/app.routes.ts` using `loadComponent: () => import(...)`.
   - Add a navigation link in `src/app/app.html` using `routerLink="/my-feature"`.

2. **Adding App-Wide Services:**
   - Place single instance services inside `src/app/core/services/service-name.service.ts` with `@Injectable({ providedIn: 'root' })`.

---

## 5. Docker Containerization & Cross-Platform Deployment

To ensure the application runs on any computer without dependency conflicts or manual environment setup, the project includes a production-grade **Multi-Stage Docker configuration**:

### Files Inventory:
- [`.dockerignore`](../frontend/.dockerignore): Prevents uploading host `node_modules/`, `.angular/` cache, and git history into the build context.
- [`nginx.conf`](../frontend/nginx.conf): Custom Nginx web server config configured with SPA fallback (`try_files $uri $uri/ /index.html;`), gzip compression, and static asset caching.
- [`Dockerfile`](../frontend/Dockerfile): Multi-stage container file:
  - **Stage 1 (Builder):** Uses `node:22-alpine` to install dependencies and run `npm run build -- --configuration production`.
  - **Stage 2 (Runtime):** Uses lightweight `nginx:alpine` (~25MB total image) to serve compiled static files on port 80.
- [`docker-compose.yml`](../docker-compose.yml): Maps port `4200:80` for single-command startup.

### How to Run on Any Computer:
```bash
# Build and start container in detached mode
docker compose up --build -d

# View live logs
docker compose logs -f

# Stop container
docker compose down
```
Once started, access `http://localhost:4200` in any browser!


---

## 6. Step 5 — Search & Add Symbol

### What was added
**Files changed:** `price.service.ts`, `watchlist.ts`

---

### `PriceService` — Key structural changes

#### `symbolUniverse` (replaces `initialAssets`)
The old `initialAssets` was a fixed 5-item array. Now a full 25-asset universe (11 crypto + 14 Indian stocks) lives here. Only a subset starts ticking — the user can add the rest via search.

#### `trackedAssets` — mutable, starts at 5
```typescript
private trackedAssets: AssetInfo[];   // starts as 5, grows on addSymbol()
```
`calculateNextPrices()` now iterates `trackedAssets` instead of a fixed list.

#### `seedAssets()` — extracted private helper
Both the constructor init AND `addSymbol()` call this — DRY principle. One place to change if seeding strategy changes.

#### `addSymbol(symbol)` — public entry point
```typescript
addSymbol(symbol: string): void {
  if (this.isTracked(symbol)) return;      // no-op guard
  const asset = this.symbolUniverse.find(...);
  this.seedAssets([asset], now);           // seed maps immediately
  this.trackedAssets.push(asset);          // included in next tick
}
```
The new card appears in the UI on the very next 1.5s interval tick.

#### `isCrypto(symbol)` — moved from Watchlist component to service
Reason: reusable by chart + portfolio without prop-drilling.

---

### `Watchlist` component — Search pipeline

```typescript
// src/app/features/watchlist/watchlist.ts — constructor
this.searchResults = toSignal(
  this.searchControl.valueChanges.pipe(
    startWith(''),        // 1. Emit initial value so signal isn't undefined
    debounceTime(300),    // 2. Wait 300ms after user stops typing
    switchMap(term =>     // 3. Cancel previous, run latest only
      of(this.priceService.searchSymbols(term ?? ''))
    )
  ),
  { initialValue: [] }
);
```

| Operator | Why it's here |
|----------|--------------|
| `startWith('')` | `toSignal` needs an initial emission. Without this, `searchResults` is `undefined` on first render. |
| `debounceTime(300)` | Prevents searching on every keystroke. Only fires 300ms after typing stops. |
| `switchMap` | Cancels previous inner Observable when a new term arrives. With `mergeMap`, a slow result for 'bit' could overwrite a fast result for 'bitcoin'. When this becomes an HTTP call in Phase 2, this cancellation is critical — and the component won't change. |

#### The blur-click problem & fix
When user clicks "Add" in the dropdown: blur fires → dropdown closes → click never registers.
- `onSearchBlur()` delays closing by 150ms so the click fires first
- `(mousedown)="$event.preventDefault()"` on dropdown prevents blur from firing when clicking inside

---

### Decision Log — Step 5

| Decision | Choice | Why |
|----------|--------|-----|
| Debounce delay | 300ms | Responsive but not noisy |
| Already-tracked symbols | Show with "✓ Tracking" badge | Better UX than hiding |
| Search scope | Ticker + full name, case-insensitive | Type "bitcoin" → find BTC, "tata" → find TCS |
| `isCrypto()` location | PriceService | Reusable, single source of truth |

---

## 7. Code Review (2026-10-17) & Tech-Debt Backlog

Review of everything built through Step 6. Verified facts: `ng build` **passes** (warns: initial bundle 555 kB > 500 kB budget); `ng test` **fails 2/2** (stale `app.spec.ts`).
Each item gets fixed only when we reach it in the step-by-step revision and you approve the change.

| # | Severity | Where | Problem | Why it matters |
|---|---|---|---|---|
| 1 | Bug | ~~price.service.ts~~ | ~~`toFixed(2)` on every tick~~ | **Fixed (Phase 2)**: crypto prices are real; the simulated walk rounds to 4 decimals below 1 ([simulated-price-feed.ts:L7](../frontend/src/app/core/services/simulated-price-feed.ts#L7)) |
| 2 | Bug | ~~price.service.ts~~ | ~~Upward-biased random walk~~ | **Fixed (Phase 2)**: symmetric ±0.4 % step in both simulators ([simulated-price-feed.ts:L62](../frontend/src/app/core/services/simulated-price-feed.ts#L62), [feeds.py:L65](../backend/app/realtime/feeds.py#L65)) |
| 3 | Bug | ~~stock-chart.ts~~ | ~~Chart invents its own timestamps~~ | **Fixed (Phase 2)**: the service is the only source of chart time ([price.service.ts:L159](../frontend/src/app/core/services/price.service.ts#L159)); the chart draws its points ([stock-chart.ts:L174](../frontend/src/app/features/watchlist/components/stock-chart.ts#L174)) |
| 4 | Design | ~~watchlist.ts~~ | ~~`getOrCreateAlertForm()` called from the template~~ | **Fixed in UI R6**: [alert-panel.ts](../frontend/src/app/features/watchlist/components/alert-panel.ts) has one form; the validator reads the price through a getter ([L29-L35](../frontend/src/app/features/watchlist/components/alert-panel.ts#L29-L35)), so nothing runs from the template |
| 5 | Logic | [alert-panel.ts:L29-L35](../frontend/src/app/features/watchlist/components/alert-panel.ts#L29-L35) | Validator only blocks `target === current` (exact float equality on a moving price) | The real "fires instantly" case, e.g. "above 100" when price is already 120, is not blocked. **Still open** (moved, behaviour unchanged on purpose) |
| 6 | Types | ~~watchlist.ts~~ | ~~Untyped `FormGroup`~~ | **Fixed in UI R6**: typed `FormControl<Direction>` / `FormControl<number \| null>` in [alert-panel.ts:L140-L147](../frontend/src/app/features/watchlist/components/alert-panel.ts#L140-L147) |
| 7 | UI bug | ~~app.html~~ | ~~`animate-in…`, `animate-[shrink_…]` undefined~~ | **Fixed (UI R1 + R7)**: keyframes in [styles.css](../frontend/src/styles.css); toasts use `animate-toast-in` / `animate-shrink` ([app.html:L63](../frontend/src/app/app.html#L63), [L95](../frontend/src/app/app.html#L95)) |
| 8 | Tests | ~~app.spec.ts~~ | ~~0 working tests~~ | **Fixed**: 15 tests in 4 files (app, auth interceptor, PriceService, WebSocket reconnect) |
| 9 | Perf | ~~watchlist.ts~~ | ~~`alertCountForSymbol()` ×6 and `isCrypto()` per card per tick~~ | **Fixed in UI R4**: `alertCountBySymbol` Map rebuilt only when alerts change ([alert.service.ts:L40-L46](../frontend/src/app/core/services/alert.service.ts#L40-L46)); row `currency` computed cut off by an equal `symbol` ([watchlist-row.ts:L73-L75](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L73-L75)) |
| 10 | Reactivity | [price.service.ts:L41](../frontend/src/app/core/services/price.service.ts#L41) | ~~Tracked list not a signal~~ **Fixed**: `trackedSymbols` is a signal ([price.service.ts:L35](../frontend/src/app/core/services/price.service.ts#L35)). **Still open**: chart history is a mutated Map, hence the `selectedRange` workaround | Low impact now |
| 11 | Arch | [app.ts:L26](../frontend/src/app/app.ts#L26) | Root `App` injects `AlertService` → `PriceService` | The price feed (now a WebSocket) is open on every route, including `/login`. Acceptable: prices are global, and alerts must fire everywhere |
| 12 | Arch | [angular.json](../frontend/angular.json) vs [Dockerfile](../frontend/Dockerfile) | SSR/Express configured, but prod serves static files via nginx | `server.ts` is still dead code in prod. `/portfolio` and `/login` are now client-rendered; only `/watchlist` is prerendered. Decide: `outputMode: "static"` or Node SSR |
| 13 | Bundle | build output | Initial **572 kB** > 500 kB budget (was 555) | Grew with HttpClient, auth and the WebSocket feed. Likely biggest win: PrimeNG + Aura used only for `<p-skeleton>`; measure with `ng build --stats-json` |
| 14 | DevOps | [nginx.conf](../frontend/nginx.conf) | `add_header` inside a `location` drops server-level headers; `X-XSS-Protection` obsolete | Still open. (Fixed separately: absolute redirects to port 80, see §12) |
| 15 | DevOps | [Dockerfile:L8](../frontend/Dockerfile#L8) | `npm ci … \|\| npm install …` | Silently hides lockfile drift; builds stop being reproducible |
| 16 | Style | [stock-chart.ts:L44-L45](../frontend/src/app/features/watchlist/components/stock-chart.ts#L44-L45) | Decorator `@Input`/`@ViewChild` while the rest uses signals | `as any` is gone (`UTCTimestamp` via `toChartPoint`); decorators still open |
| 17 | Structure | [watchlist.ts](../frontend/src/app/features/watchlist/watchlist.ts) | Was 551 lines: page + search + card + alert form in one component | **Mostly fixed in UI R4/R6**: now 243 lines; row and alert form are their own components. Search is still inline (could become `search-box`) |
| 18 | Minor | [alert.service.ts:L69](../frontend/src/app/core/services/alert.service.ts#L69) | ID = `symbol-Date.now()` | Two alerts in the same ms collide; prefer `crypto.randomUUID()` |

---

## 8. UI Redesign: "Trading Terminal" Look (started 2026-10-17)

Goal: make the app look like a real trading terminal (Kite / TradingView / Binance) instead of a card dashboard.
Plan (one approved step each): **R1** design tokens + fonts → R2 header → R3 3-pane layout shell → R4 extract `<app-watchlist-row>` + tick flash → R5 chart panel header + chart colours from tokens → R6 extract `<app-alert-panel>` (fixes Backlog #4) → R7 toasts.

Target layout (Watchlist page):
```
┌──────────────────────────────────────────────────────┐
│ ◆ PriceTracker  Watchlist Portfolio  [⌕ Search] ● 14:02│
├────────────┬───────────────────────────┬─────────────┤
│ SYMBOL  LTP│ BTC  $67,412.30  +1.24%   │ ALERTS · BTC│
│ BTC 67,412▲│ H 67,900  L 66,100        │ ▲ 68,000  ✕ │
│ ETH  3,201▼│        chart              │ [Set alert] │
└────────────┴───────────────────────────┴─────────────┘
```

### R1: Design tokens & fonts ✅

**Files:** [styles.css](../frontend/src/styles.css) (whole file), [index.html:L9-L12](../frontend/src/index.html#L9-L12)

- [styles.css:L10-L70](../frontend/src/styles.css#L10-L70): a Tailwind v4 `@theme` block (made `@theme static` in R5) defines colours (`surface-0/1/2`, `line`, `ink`, `ink-muted`, `ink-faint`, `up`, `down`, `accent`, `warn`), fonts (`sans` = Inter, `mono` = JetBrains Mono), and animations (`flash-up/down`, `toast-in`, `shrink`).
  Each token becomes both a utility class (`text-up`, `bg-surface-1`) and a CSS variable (`var(--color-up)`), which the canvas chart can read in JS.
- [styles.css:L72-L74](../frontend/src/styles.css#L72-L74): `body` gets the page background, text colour and font.
- [index.html:L9](../frontend/src/index.html#L9): `<meta name="color-scheme" content="dark">` makes native scrollbars and inputs dark.
- [index.html:L10-L12](../frontend/src/index.html#L10-L12): Google Fonts with `preconnect` + `display=swap`. The production build inlines the font CSS (`@font-face`) into the HTML, so it costs no extra blocking request.

**Verified:** `ng build` passes. Output CSS contains `--color-up: #16c784` and `@keyframes shrink`. Prerendered HTML contains the inlined `@font-face`.
Note: `@keyframes flash-up`, `toast-in` etc. are **not** in the output yet. Tailwind only emits keyframes that a used class references, so they appear once R4/R7 use them.

**Known limitation found while verifying (fixed later, see "Extra: PrimeNG dark mode" below):** PrimeNG (`darkModeSelector: 'system'`, then at app.config.ts L23) injects `:root { color-scheme: light }` with a dark override only under `prefers-color-scheme: dark`. The CSS property beats our `<meta>`, so on a **light OS theme** scrollbars and inputs will still be light. Not fixed yet (candidate small change).

```
Step: UI R1
Decision: Custom near-black neutral palette as Tailwind v4 @theme tokens; Inter + JetBrains Mono from Google Fonts
Options considered: keep Tailwind slate colours; plain :root CSS variables; @fontsource npm packages; system fonts
Why I chose it: one source of truth for HTML and canvas; colour only carries meaning (up/down); no dependency install; consistent look across OSes
What I'd reconsider at larger scale: self-host fonts (@fontsource) for privacy/GDPR and offline; a light theme would need the tokens redefined under a selector
```

### R2: Slim terminal header ✅

**File:** [app.html:L1-L51](../frontend/src/app/app.html#L1-L51) (toast block below it unchanged)

- [L1](../frontend/src/app/app.html#L1): `h-dvh flex flex-col`. The page itself never scrolls; header + `main` fill exactly the viewport.
- [L2](../frontend/src/app/app.html#L2): 48 px header (`h-12`) on `bg-surface-1`. Gradients, glow shadows and nav icons removed.
- [L15-L24](../frontend/src/app/app.html#L15-L24): tab-style nav. Active tab is styled through `aria-current="page"` (set by `ariaCurrentWhenActive`), which always beats the base `text-ink-muted` on specificity. See ANGULAR_FRAMEWORK_GUIDE §4.
- [L28-L36](../frontend/src/app/app.html#L28-L36): Feed status dot. Since Phase 2 it shows the real WebSocket state: Live / Reconnecting… / Connecting… / Simulated feed (`feedLabel`, `feedDotClass` in app.ts).
- [L53](../frontend/src/app/app.html#L53): `main` is `flex-1 min-h-0 overflow-auto`. `min-h-0` overrides the flex default `min-height: auto`, without which `main` would grow to its content and never scroll.

**Verified:** `ng build` passes (initial bundle 555.8 → 552.8 kB, fewer utility classes). Prerendered `/watchlist` HTML has `aria-current="page"` on the Watchlist link; CSS contains `[aria-current=page]{color:var(--color-ink)}`.

**Plan change:** search stays at the top of the left pane (as in Kite) instead of moving to the header. Moving it would require lifting its state out of `Watchlist` into a service or header component.

### R3–R7 (applied together on the owner's request, "do all the changes")

Data flow on the Watchlist page now:
```
PriceService.pricesSignal ──► Watchlist (page state: selectedSymbol, search)
                                 ├─ @for → <app-watchlist-row [stock] [selected] [alertCount]> ──(selectSymbol)──► selectedSymbol.set()
                                 ├─ selectedStock / selectedRange (computed) → centre header
                                 ├─ <app-stock-chart [symbol]>  (subscribes to prices$ itself)
                                 └─ <app-alert-panel [symbol] [price] [currency]> ──► AlertService.addAlert/removeAlert
AlertService.alertCountBySymbol (Map) ──► row badge
AlertService.toasts ──► App (toast stack, every route)
```

#### R3: 3-pane layout shell
[watchlist.ts:L52-L55](../frontend/src/app/features/watchlist/watchlist.ts#L52-L55): CSS grid.
- `< lg`: one column (list → chart → alerts); the list is capped at `45dvh` so the chart stays reachable ([L148](../frontend/src/app/features/watchlist/watchlist.ts#L148)).
- `lg` (1024 px+): `300px | minmax(0,1fr)`; alerts sit under the chart (row 2, max 18 rem tall).
- `xl` (1280 px+): `320px | minmax(0,1fr) | 300px`.
Each pane scrolls on its own (`min-h-0` + `overflow-y-auto`); the page never scrolls on desktop. The page title, "LIVE FEED" badge and big stat boxes were replaced by a 40 px strip: count, ▲ gainers, ▼ losers ([L59-L70](../frontend/src/app/features/watchlist/watchlist.ts#L59-L70)).
Search stays at the top of the left pane ([L73-L134](../frontend/src/app/features/watchlist/watchlist.ts#L73-L134)), restyled; logos replaced by a CRYPTO/NSE tag. **Behaviour change:** adding a symbol now also selects it ([L274](../frontend/src/app/features/watchlist/watchlist.ts#L274)).

#### R4: `<app-watchlist-row>` + tick flash
New [watchlist-row.ts](../frontend/src/app/features/watchlist/components/watchlist-row.ts): 56 px row (symbol, name, alert dot · price, ▲/▼ %). Signal `input()`/`output()`.
- Flash: `flashClass` ([L83-L88](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L83-L88)) compares `price` vs `previousPrice` (already in the model). Replayed every tick by the `@for … track updatedAt` trick ([L44-L48](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L44-L48), see ANGULAR_FRAMEWORK_GUIDE §21).
- Two colours mean two different things: the **flash** is tick-to-tick, the **% text** is vs. the session's base price.
- Numbers use `DecimalPipe` `'1.2-4'` (2 to 4 decimals) instead of `toLocaleString()`, plus `font-mono tabular-nums` so columns don't wobble.
- Perf (Backlog #9): see ANGULAR_FRAMEWORK_GUIDE §17. Removed from `AlertService`: `alertCountForSymbol()`, `alertsForSymbol()` (no callers left). Removed from `Watchlist`: `getLogoBgClass()`, the per-card alert form code.

#### R5: Chart panel
- Header moved from the chart into the page centre pane ([watchlist.ts:L175-L198](../frontend/src/app/features/watchlist/watchlist.ts#L175-L198)): symbol, name, price, change (abs + %), H/L of the last 50 ticks, last tick time.
  `selectedRange` ([L246-L250](../frontend/src/app/features/watchlist/watchlist.ts#L246-L250)) reads `pricesSignal()` only to re-run per tick, because the history array is mutated in place (not a signal). Workaround tied to Backlog #10.
- [stock-chart.ts](../frontend/src/app/features/watchlist/components/stock-chart.ts): template is just the canvas host; `autoSize: true` replaces our `ResizeObserver` (fills width **and** height); colours come from the CSS tokens via `getComputedStyle` ([L92-L100](../frontend/src/app/features/watchlist/components/stock-chart.ts#L92-L100)); area turns green/red with the session direction, `applyOptions` only when it flips ([L190-L199](../frontend/src/app/features/watchlist/components/stock-chart.ts#L190-L199)).
- `@theme` → `@theme static` in styles.css, because Tailwind dropped token variables no class used (`--color-warn`), and the chart reads them from JS.
- Mobile bug caught in review: `h-full` in an auto-height parent is 0, so the chart wrapper is `h-80` on mobile and `lg:flex-1` on desktop ([L201](../frontend/src/app/features/watchlist/watchlist.ts#L201)).

#### R6: `<app-alert-panel>`
New [alert-panel.ts](../frontend/src/app/features/watchlist/components/alert-panel.ts) in the right pane, for the selected symbol only: active alerts list with ✕, Above/Below segmented control, target input, "Set alert".
One typed form instead of a `Map<symbol, FormGroup>`; fixes Backlog #4 and #6. The target is cleared when the symbol changes (`effect` + `untracked`, [L152-L155](../frontend/src/app/features/watchlist/components/alert-panel.ts#L152-L155)).
**Behaviour change:** the bell button on each card is gone. Select a row, and the alerts pane shows that symbol. Rows with alerts show an amber `● n`.

#### R7: Toasts
[app.html:L57-L99](../frontend/src/app/app.html#L57-L99): flat card with amber left edge, `motion-safe:animate-toast-in`, `animate-shrink` progress bar, `bottom-4 right-4` (moved from top-right in Phase 2: it covered the alerts pane), `role="status" aria-live="polite"` so screen readers announce alerts. `DecimalPipe` added to [app.ts:L119](../frontend/src/app/app.ts#L19).

#### Extra: PrimeNG dark mode + Portfolio
- [app.config.ts:L25](../frontend/src/app/app.config.ts#L25) `darkModeSelector: '.app-dark'` + [index.html:L2](../frontend/src/index.html#L2) `<html class="app-dark">`. PrimeNG now emits `.app-dark{color-scheme:dark}` after its `:root{color-scheme:light}`; equal specificity, later rule wins, so dark always applies. (Your PrimeNG `license` line in app.config.ts was kept untouched.)
- [portfolio.ts](../frontend/src/app/features/portfolio/portfolio.ts) restyled with the tokens.

**Verified:** `ng build` passes; initial bundle **555.8 → 526.2 kB** (still over the 500 kB budget, Backlog #13). Output CSS contains `@keyframes flash-up`, `toast-in`, `shrink`, and `--color-warn`. Prerendered `/watchlist` shows skeleton rows (no prices exist at build time, as expected). `ng test`: same 2 failures as before (Backlog #8), no new ones.
**Not verified:** I could not look at the running UI. Check in the browser: rows flash on each tick; the chart fills the centre and resizes with the window; alerts pane follows the selected row; a toast slides in when an alert fires; layout at < 1024 px, 1024–1279 px, ≥ 1280 px.

```
Step: UI R3–R7
Decision: 3-pane terminal layout (list | chart | alerts) with extracted <app-watchlist-row> and <app-alert-panel>
Options considered: 2-pane (alerts under chart); keep the card grid restyled; resizable split panes
Why I chose it: owner picked the 3-pane option; chart always visible; dense rows show ~15 symbols without scrolling; extraction fixed Backlog #4, #6, #9 and most of #17 along the way
What I'd reconsider at larger scale: virtual scrolling for 200+ rows (Step 7; fixed 56 px rows make it easy); per-tick DOM recreation for the flash → Web Animations API; history as a signal (#10) to drop the selectedRange workaround
```

---

## 9. Phase 1 Step 7: Scale Test + Virtual Scrolling ✅

**Goal (build guide):** prove, with a measurement, what virtual scrolling changes.

**What was built**
- `?scale=200` adds 200 deterministic fake symbols TST001… ([asset-universe.ts:L50](../frontend/src/app/core/data/asset-universe.ts#L50)) and puts them all on the watchlist (205 rows). It implies the in-browser simulated feed.
- The watchlist list is a CDK virtual-scroll viewport ([watchlist.ts:L148-L152](../frontend/src/app/features/watchlist/watchlist.ts#L148-L152)); `?virtual=0` renders every row instead ([watchlist.ts:L227](../frontend/src/app/features/watchlist/watchlist.ts#L227)).
- Rows are exactly 56 px: the border is inside the row and the host is `display:block` ([watchlist-row.ts:L57](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L57)).

**Measurement** (headless Chrome via the DevTools protocol, 1440×900, production Docker build, 10 s of steady ticking, two runs each; `Performance.getMetrics` deltas):

| | Rows in DOM | Main-thread task time / 10 s | Style recalc | Layout | Script |
|---|---|---|---|---|---|
| Virtual **on** | **24** | **533–547 ms** | 85–103 ms | 37–40 ms | 93–143 ms |
| Virtual **off** | 205 | 1,705–2,129 ms | 580–709 ms | 205–253 ms | 280–429 ms |

**What virtual scrolling changed (observed, not guessed):** about **3.5× less main-thread work**, **~7× less style recalculation**, ~6× less layout.
Why style/layout dominate: every tick changes ~205 price texts + flash classes, and the browser has to restyle and lay out every one of them. With virtual scrolling only the ~24 visible rows exist, so only they pay that cost.
`OnPush` + `track` still matter. Without them, Angular would also re-create rows (not just update text) on every snapshot.

**How to repeat it yourself:** run `docker compose up -d`, open `http://localhost:4200/watchlist?scale=200`, then DevTools → Performance → record 10 s. Repeat with `&virtual=0`. Compare "Rendering" and "Painting" in the summary.

```
Step: Phase 1 Step 7
Decision: Measure with Chrome DevTools Performance metrics (automated via the DevTools protocol), compare ?virtual=0
Options considered: FPS counter; visually judging scroll smoothness
Why I chose it: numbers instead of impressions; repeatable
What I'd reconsider at larger scale: at 1,000+ symbols the bottleneck moves to the data side (one snapshot array per 250 ms); then send only changed rows (deltas)
```

---

## 10. Phase 1.5: Custom Auth (FastAPI + Angular) ✅

### System picture
```
Browser (Angular)                         nginx / dev proxy            FastAPI (backend/)            SQLite
 AuthService ── POST /api/auth/login ───────► same origin ──────────► routers/auth.py ───────────► users, sessions
   ▲ access token (memory)  ◄── JSON {access_token} + Set-Cookie: refresh_token (httpOnly, SameSite=Strict, Path=/api/auth)
 authInterceptor ── GET /api/portfolio  Authorization: Bearer … ──► deps.get_current_user (JWT + session check)
   on 401 → POST /api/auth/refresh (cookie sent automatically) → new access token → retry once
```

### Backend ([backend/](../backend))
- **Passwords:** Argon2id via `pwdlib` ([security.py:L14](../backend/app/security.py#L14)). Login against an unknown email still runs a hash ([security.py:L18](../backend/app/security.py#L18)), so response time doesn't reveal which emails exist. Same error message for both cases.
- **Access token:** a 15-minute HS256 JWT with `sub` (user id) and `sid` (session id) ([security.py:L34](../backend/app/security.py#L34)).
- **Refresh token:** a random 256-bit string, *not* a JWT ([security.py:L78](../backend/app/security.py#L78)). Only its SHA-256 hash is stored ([security.py:L83](../backend/app/security.py#L83)), so a database leak doesn't leak usable tokens.
- **Sessions table** ([models.py:L27](../backend/app/models.py#L27)): id, user_id, token_hash, user_agent, created/expires/revoked. Login revokes every previous session of that user ([auth.py:L110](../backend/app/routers/auth.py#L110)).
- **Every protected request checks the session** ([deps.py:L23](../backend/app/deps.py#L23)): a valid JWT from a revoked session gets 401 `session_revoked`. Costs one indexed SQLite read per request; in exchange, "log in elsewhere" kicks old tokens out immediately instead of up to 15 minutes later.
- **Cookie** ([auth.py:L66-L75](../backend/app/routers/auth.py#L66-L75)): `httponly` (no JS access, so XSS can't steal it), `samesite=strict` (no cross-site sending, so no CSRF), `path=/api/auth` (not attached to every API call), `secure` from env (must be `true` behind HTTPS).
- Endpoints: `POST /api/auth/register | login | refresh | logout`, `GET /api/auth/me`, protected `GET /api/portfolio` (demo holdings, [portfolio.py](../backend/app/routers/portfolio.py)).

### Frontend
- [auth.service.ts:L37](../frontend/src/app/core/auth/auth.service.ts#L37): `user` / `isLoggedIn` signals; the access token is a private signal (memory only).
- [auth.interceptor.ts:L25](../frontend/src/app/core/auth/auth.interceptor.ts#L25): adds the bearer token to `/api/*`; on 401 does refresh → retry once; if the refresh fails, ends the session.
- [auth.guards.ts:L9](../frontend/src/app/core/auth/auth.guards.ts#L9) on `/portfolio`, [auth.guards.ts:L15](../frontend/src/app/core/auth/auth.guards.ts#L15) on `/login`.
- [app.config.ts:L34-L37](../frontend/src/app/app.config.ts#L34-L37): restores the session from the cookie **before** the first navigation, so a page reload doesn't log you out.
- [login.ts](../frontend/src/app/features/auth/login.ts): one page for login and register (typed reactive form; `returnUrl` limited to same-app paths).
- [portfolio.ts](../frontend/src/app/features/portfolio/portfolio.ts): `httpResource('/api/portfolio')` + live prices → value and P&L per holding.

### Decision Log
```
Step: Phase 1.5 Step 1 (owner's decision)
Decision: sessions table (session_id, user_id, token_hash, user_agent, expires/revoked)
Options considered: single refresh-token column on users
Why I chose it: revocation per login, room for "list my devices", token never stored in plain text
What I'd reconsider at larger scale: move session checks to Redis (fast, with TTL) instead of a SQL read per request

Step: Phase 1.5 Step 1
Decision: access 15 min / refresh 7 days; refresh token NOT rotated
Options considered: rotate refresh token on every /refresh (with reuse detection)
Why I chose it: rotation races when two tabs refresh at once (second tab presents the revoked token → logged out); a grace window fixes that but adds complexity
What I'd reconsider at larger scale: rotation + reuse detection + short grace period (industry best practice)

Step: Phase 1.5 Step 2 (owner's decision)
Decision: access token in memory, refresh token in httpOnly SameSite=Strict cookie
Options considered: both in cookies (needs CSRF tokens); localStorage (readable by any XSS)
Why I chose it: JS can never read the long-lived secret; the short-lived one dies with the tab
What I'd reconsider at larger scale: nothing structural; add CSP headers to make XSS itself harder

Step: Phase 1.5 Step 2
Decision: same-origin API via dev proxy / nginx instead of CORS
Options considered: CORS with allow_credentials and explicit origins
Why I chose it: no preflight requests, no cross-origin cookie rules, one less thing to misconfigure
What I'd reconsider at larger scale: an API on its own domain (api.example.com) would need CORS + SameSite=None; Secure cookies
```

---

## 11. Phase 2: Live Data + Redis Fan-Out ✅

### System picture
```
                 ONE upstream socket, however many users
Binance WS ───────────────► binance_feed ─┐
(11 crypto, miniTicker 1/s)               │ publish()                         ┌─► browser tab 1
                                          ├──► Redis: SET price:last:X        │
simulated_stock_feed (14 NSE, 1.5 s) ─────┘     RPUSH/LTRIM price:history:X   │
                                                PUBLISH prices:X ──► hub.listen (PSUBSCRIBE prices:*)
                                                                      │  one per backend instance
                                                                      └─► ConnectionHub: symbol → {sockets} ─► tab 2, tab 3 …
```

### Backend
- **Producers** ([feeds.py](../backend/app/realtime/feeds.py)): `binance_feed` opens **one** combined-stream socket for all 11 crypto symbols ([feeds.py:L40](../backend/app/realtime/feeds.py#L40)); `simulated_stock_feed` random-walks the NSE stocks server-side ([feeds.py:L58](../backend/app/realtime/feeds.py#L58)). Both are wrapped in `run_forever` (restart with 1 → 30 s backoff, [feeds.py:L20](../backend/app/realtime/feeds.py#L20)), which covers Binance drops and Redis outages.
- MATIC is mapped to Binance's `POLUSDT` (renamed in 2024): [symbols.py:L15](../backend/app/symbols.py#L15).
- **Broker** ([broker.py:L21-L31](../backend/app/realtime/broker.py#L21-L31)): one pipelined round-trip writes the latest price, appends history (last 300), and publishes to `prices:<SYMBOL>`. `snapshot()` gives a new subscriber the latest price + history, so the chart isn't empty.
- **Hub** ([hub.py](../backend/app/realtime/hub.py)): one Redis pattern subscription **per backend instance**, then an in-memory registry `symbol → sockets` fans out locally. Redis connections grow with server instances, not with users.
- **WebSocket endpoint** ([ws.py:L27](../backend/app/routers/ws.py#L27)): JSON protocol `subscribe` / `unsubscribe` → `snapshot` / `tick`. Unknown symbols ignored, max 50 per client. Registered in the hub *before* the snapshot is read, so no tick falls between the two.
- `/api/health` ([main.py:L54](../backend/app/main.py#L54)) exposes counters. **Proof of fan-out:** with two clients connected, `binance_connections` stays at `1`.

### Frontend
- `PriceFeed` abstraction ([price-feed.ts](../frontend/src/app/core/services/price-feed.ts)) with three implementations: WebSocket (live), Simulated (`?feed=sim`, `?scale=N`), Noop (server prerender). Chosen in [price-feed.provider.ts:L15-L21](../frontend/src/app/core/services/price-feed.provider.ts#L15-L21). **No component changed** when the data source did.
- [websocket-price-feed.ts](../frontend/src/app/core/services/websocket-price-feed.ts): RxJS `webSocket`, status signal, reconnect with exponential backoff + jitter, re-subscribe everything on reconnect, clean-close handling.
- [price.service.ts](../frontend/src/app/core/services/price.service.ts): applies ticks/snapshots to state, batches UI updates with `auditTime(250)`, owns chart history (fixes #3), ignores out-of-order ticks.
- Header shows Live / Reconnecting… / Connecting… / Simulated feed ([app.ts:L9-L14](../frontend/src/app/app.ts#L9-L14)); NSE rows show a `SIM` tag in live mode ([watchlist-row.ts:L78](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L78)).

### Decision Log
```
Step: Phase 2 Step 1
Decision: one FastAPI app for auth + WebSocket + feeds
Options considered: separate auth service and price service
Why I chose it: one deployable for a side project; the code is already split by router/module
What I'd reconsider at larger scale: run feeds as a separate single-instance worker (see Tech Debt), scale the WebSocket tier horizontally

Step: Phase 2 Step 2 (owner's decision)
Decision: hybrid: crypto live from Binance, NSE stocks simulated server-side, both through the same Redis channels
Options considered: crypto only; stocks simulated in the browser
Why I chose it: one data path for every symbol; the frontend can't tell (except the SIM tag)
What I'd reconsider at larger scale: a paid NSE feed would plug in as just another producer

Step: Phase 2 Step 2
Decision: pass through last price + 24 h open (miniTicker c/o/E), no rounding
Options considered: full ticker (bid/ask/volume); trade stream
Why I chose it: smallest payload that gives price and change %
What I'd reconsider at larger scale: add bid/ask/volume when an order book or depth view is needed

Step: Phase 2 Step 3
Decision: one Redis channel per symbol (prices:BTC); one PSUBSCRIBE per backend instance + local fan-out
Options considered: one channel with symbol in payload; one Redis subscription per browser client
Why I chose it: channel-per-symbol is easy to inspect (redis-cli PSUBSCRIBE prices:*); per-instance subscription keeps Redis connections independent of user count
What I'd reconsider at larger scale: subscribe only to symbols some local client wants (instead of prices:*); Redis Streams if messages must survive restarts

Step: Phase 2 Step 3: "what if Redis goes down?"
Decision: accept downtime: feeds and listener retry with backoff, clients keep their last prices and see "Live" but no ticks
Options considered: in-memory fallback broadcast
Why I chose it: honest scope for a side project
What I'd reconsider at larger scale: Redis Sentinel/Cluster or a managed Redis; a heartbeat so the UI can show "stale"

Step: Phase 2 Step 4
Decision: exponential backoff 1 s → 30 s with 20 % jitter; visible "Reconnecting…" status
Options considered: fixed 3 s retry; silent reconnect
Why I chose it: avoids a thundering herd after a server restart; users should know when prices are stale
What I'd reconsider at larger scale: server-sent "retry-after" hints; resume from last seen timestamp instead of a full snapshot

Step: Phase 2 Step 4
Decision: batch UI updates with auditTime(250)
Options considered: render every tick; requestAnimationFrame batching
Why I chose it: ~25 ticks/s → at most 4 renders/s, always showing the latest value
What I'd reconsider at larger scale: rAF-based batching, or move tick processing into a Web Worker
```

---

## 12. Phase 2 Step 5: Final Verification (2026-10-17)

How it was checked: curl and Python/Node WebSocket clients against the API, plus a headless Chrome script driving the real UI through the production Docker stack (nginx → FastAPI → Redis → Binance).

| Build-guide checklist item | Result |
|---|---|
| Fresh browser, not logged in → redirected away from `/portfolio` | ✅ `/portfolio` → `/login?returnUrl=%2Fportfolio` |
| Register, log in, land on the app | ✅ register auto-logs-in and returns to `/portfolio` (or `/watchlist` without returnUrl) |
| Search and add a real symbol | ✅ (search/add unchanged; BTC/ETH are live from Binance) |
| Chart updates with genuinely live data | ✅ BTC ≈ $81.5k from Binance; header shows "Live" |
| Set an alert, watch it fire | ✅ toast "BTC ▼ below 82,354.00 · Hit 81,538.80" |
| Two tabs update together, Binance hit once | ✅ two WebSocket clients got identical snapshots/ticks; `/api/health` → `binance_connections: 1` |
| Kill and restart backend → frontend reconnects | ✅ unit-tested with a fake WebSocket (clean close → "Reconnecting…" → new socket after ~1 s → re-subscribes all symbols). Backend restarts during testing were recovered by Binance/Redis retry loops. **Not yet watched by a human in a real browser.** |
| Access token expires → silent refresh keeps you logged in | ✅ with 5 s tokens: `401 /api/portfolio → 200 /api/auth/refresh → 200 /api/portfolio`, still on `/portfolio`; a page reload also stays logged in |
| Logout | ✅ cookie revoked; `/portfolio` redirects to login again |
| Unit tests | ✅ 15/15 (`npx ng test --watch=false`) |
| Console errors during the browser flows | none |

**Bug found and fixed during verification:** in the Docker build, opening `http://localhost:4200/watchlist` redirected to `http://localhost/watchlist/` (port 80). nginx's `$uri/` rule found the prerendered `watchlist/` folder and sent an **absolute** redirect using its internal port. Fixed with `absolute_redirect off` and `try_files $uri $uri/index.html /index.html` ([nginx.conf:L13-L21](../frontend/nginx.conf#L13-L21)).

---

## 13. How to Run Everything

```bash
# Full stack (production build): nginx :4200 → FastAPI :8000 → Redis :6379
docker compose up -d --build
open http://localhost:4200                          # live data, login, portfolio

# Frontend dev with hot reload (backend must be running, e.g. via docker compose)
cd frontend && npm start                                           # http://localhost:4200, /api proxied to :8000

# Frontend only, no backend
http://localhost:4200/watchlist?feed=sim            # in-browser simulated prices
http://localhost:4200/watchlist?scale=200           # Step 7 scale test (add &virtual=0 to compare)

# Watch the fan-out
curl http://localhost:4200/api/health               # binance_connections stays 1
docker exec -it price_tracker_redis redis-cli PSUBSCRIBE 'prices:*'

# Test silent refresh with 30-second access tokens
ACCESS_TOKEN_SECONDS=30 docker compose up -d backend
```

Environment variables live in **`.env`** at the repo root (git-ignored; template with explanations: [.env.example](../.env.example)); `docker compose` reads it automatically. Backend variables: `JWT_SECRET` (**required**; compose refuses to start without it), `ACCESS_TOKEN_SECONDS` (900), `REFRESH_TOKEN_DAYS` (7), `COOKIE_SECURE` (`true` behind HTTPS), `ENABLE_BINANCE` (`true`), `REDIS_URL`, `DATABASE_URL`.

---

## 14. Tech-Debt Backlog: additions from Phase 1.5 / 2

| # | Severity | Where | Problem | Why it matters |
|---|---|---|---|---|
| 19 | Security | [auth.py:L172](../backend/app/routers/auth.py#L172) | Refresh token never rotates | A stolen cookie works for 7 days unless the user logs in again. Rotation + reuse detection would limit it |
| 20 | Scale | [main.py:L23](../backend/app/main.py#L23) | Feeds run inside the API process | Two backend instances = two Binance sockets and duplicate simulated ticks. Move feeds to one separate worker |
| 21 | Scale | [hub.py:L52](../backend/app/realtime/hub.py#L52) | One slow client delays the broadcast loop | Needs a per-client bounded queue and dropping clients that fall behind |
| 22 | Scale | [db.py](../backend/app/db.py) | SQLite + `create_all()` | Single writer, no migrations. Postgres + Alembic before multiple instances or schema changes |
| 23 | Security | [docker-compose.yml](../docker-compose.yml) | ~~Default `JWT_SECRET`~~ **fixed**: secret now required from `.env` (random 64 chars). Still open: `COOKIE_SECURE=false`, Redis port published | Fine on a laptop, dangerous if deployed as is |
| 24 | Abuse | [ws.py:L27](../backend/app/routers/ws.py#L27) | WebSocket has no auth, rate limit or connection cap | Anyone can open many sockets. Prices are public, but server resources aren't |
| 25 | Abuse | [auth.py](../backend/app/routers/auth.py) | No login rate limiting / lockout | Password guessing is only slowed by Argon2 |
| 26 | UX | [websocket-price-feed.ts](../frontend/src/app/core/services/websocket-price-feed.ts) | Status shows "Live" even when Redis/Binance are down but the socket is up | Add a server heartbeat / last-tick age to show "stale" |
| 27 | Product | [portfolio.py](../backend/app/routers/portfolio.py) | Portfolio holdings are hard-coded demo data | Needs a holdings table + CRUD |
| 28 | Logic | [portfolio.ts](../frontend/src/app/features/portfolio/portfolio.ts) | No portfolio total: holdings mix $ and ₹ | Needs an FX rate to sum across currencies |

---

## 15. Google Login ("Sign in with Google") ✅

### Flow
```
Login page ── loads accounts.google.com/gsi/client ── renders Google's button (iframe)
   │ user picks an account in Google's popup
   ▼
Google ──► our page: credential = ID token (JWT signed by Google, aud = our client ID)
   │ POST /api/auth/google {credential}
   ▼
FastAPI: verify signature with Google's public keys (cached) + aud + iss + exp + email_verified
   │ find user by google_sub → else by email (link) → else create (no password)
   ▼
_start_session(): same access token + httpOnly refresh cookie as a password login
```
Everything after "we know who you are" is shared with password login ([auth.py:L107](../backend/app/routers/auth.py#L107)). Interceptor, guards, refresh and logout needed **no changes**.

### Backend
- [security.py:L56-L75](../backend/app/security.py#L56-L75): `PyJWKClient` fetches Google's public keys from `https://www.googleapis.com/oauth2/v3/certs` and caches them. `jwt.decode` checks the RS256 signature, `aud` == our client ID (a token Google issued for another website is useless here), and `exp`; then `iss` must be Google.
- [auth.py:L138](../backend/app/routers/auth.py#L138): rejects unverified emails, then finds the user by `google_sub` (Google's permanent user id, unlike email), else **links** to an existing account with the same Google-verified email, else creates a password-less account. Same email under a *different* Google account → 409, never merged silently.
- [auth.py:L132](../backend/app/routers/auth.py#L132): `GET /api/auth/config` returns the public client ID (or null → button hidden). Configured via `GOOGLE_CLIENT_ID` in [docker-compose.yml](../docker-compose.yml).
- Schema: `users.password_hash` is now nullable, plus a unique `google_sub` ([models.py:L23](../backend/app/models.py#L23)). The existing SQLite table was migrated in place by [db.py:L27](../backend/app/db.py#L27) (rebuild + copy, in one transaction). That's exactly what Alembic would generate (Tech Debt #22).
- Dependency: `pyjwt[crypto]` (adds `cryptography`, needed for RSA signatures).

### Frontend
- [google-identity.service.ts:L37](../frontend/src/app/core/auth/google-identity.service.ts#L37): loads Google's script **lazily** (only when the login page is shown, once), renders the button, `disableAutoSelect()` on logout. Hand-written minimal types instead of an `@types` package.
- [login.ts:L155-L168](../frontend/src/app/features/auth/login.ts#L155-L168): draws the button after the DOM exists (see ANGULAR_FRAMEWORK_GUIDE §32). Google and email login share `finish()` ([login.ts:L186](../frontend/src/app/features/auth/login.ts#L186)).
- [auth.service.ts:L65](../frontend/src/app/core/auth/auth.service.ts#L65).

### Verification
- 18 backend checks with a locally generated "Google" RSA key: migration keeps all users and password hashes and is idempotent; new user / same user / link / 409; Google-only accounts can't password-login; cookie + refresh work; **rejected**: unverified email, wrong audience, wrong issuer, expired token, token signed by another key.
- The real Google key endpoint is reachable from the backend (2 keys fetched).
- Production Docker stack: migration ran on the real database (4 users kept, password login still 200); headless Chrome renders Google's button on `http://localhost:4200/login` with no errors.
- **Not verified: an actual Google sign-in.** It needs a real Google account in a real browser, and your Client ID must list the origin (below).

### Google Cloud Console checklist (your Client ID)
APIs & Services → Credentials → your OAuth 2.0 Client ID (type *Web application*) → **Authorized JavaScript origins**:
- `http://localhost:4200`
- `http://localhost` (Google requires the port-less one too for localhost testing)

No redirect URIs are needed (popup mode). If an origin is missing, Google's popup shows "Error 400: origin_mismatch". The OAuth consent screen must be configured; while it's in "Testing" mode, only listed test users can sign in.

```
Step: Google login
Decision: Google Identity Services button → ID token → POST /api/auth/google → our own session
Options considered: server-side authorization-code redirect flow (needs client secret, state/PKCE)
Why I chose it: no secret to store; reuses the whole existing session/cookie/refresh system unchanged
What I'd reconsider at larger scale: the redirect flow if we want no third-party script on our page (CSP), or more providers (then a library like Authlib)

Step: Google login, account linking (owner's decision)
Decision: link to an existing password account when Google says the email is verified; 409 if the email belongs to another Google account
Options considered: refuse and ask for password login
Why I chose it: Google has verified the person owns the address, so it's the same person; friction-free
What I'd reconsider at larger scale: ask for the password once before linking (defends against a compromised email provider)
```

New tech-debt items:

| # | Severity | Where | Problem | Why it matters |
|---|---|---|---|---|
| 29 | Noise | [auth.service.ts:L108](../frontend/src/app/core/auth/auth.service.ts#L108) | Every logged-out page load calls `/refresh` and gets a 401 (red line in the console) | Harmless but confusing; a non-httpOnly "has_session=1" hint cookie would let the app skip the call |
| 30 | Security | [google-identity.service.ts:L30](../frontend/src/app/core/auth/google-identity.service.ts#L30) | Google's script runs on our login page | Third-party code with page access; a Content-Security-Policy should allow only `accounts.google.com` |

---

## 16. Repository Reorganisation: `frontend/`, `backend/`, `docs/` (2026-10-17)

**Before:** the repo root *was* the Angular project, and `backend/` sat inside it, as if the backend were part of the frontend.
**After:**
```
Price-Tracker/
├── frontend/   Angular app + its Dockerfile, nginx.conf, proxy.conf.json, package.json, tsconfig*, .postcssrc.json, .prettierrc
├── backend/    FastAPI app (unchanged)
├── docs/       PROJECT_ARCHITECTURE_GUIDE, ANGULAR_FRAMEWORK_GUIDE, LEARNING_PATH + learning/, original build guide
├── tools/      check_doc_links.py
└── docker-compose.yml, README.md, AGENTS.md, CLAUDE.md, .editorconfig, .vscode/   (shared, at the root)
```
What had to change with it:
- [docker-compose.yml](../docker-compose.yml): the frontend image is built from `context: ./frontend`. Side benefit: the
  Docker build context no longer includes `backend/` or `docs/`.
- `.vscode/tasks.json`: the npm tasks run in `frontend/` (`"path": "frontend"`).
- All ~450 doc links were rewritten to the new locations (old target → new target, recomputed per doc).
- Tailwind scans the folder it runs from, which is now `frontend/`, so the Markdown docs (full of old class names in
  code snippets) are no longer scanned and don't add CSS (ANGULAR_FRAMEWORK_GUIDE §15 "Common Mistakes").
- Commands: frontend commands run inside `frontend/`; `docker compose` runs at the root (see [README](../README.md)).
- Tracked files were moved with `git mv`, so git shows them as renames and their history follows them.

```
Step: Repository layout
Decision: monorepo with sibling frontend/ and backend/ folders, shared docs/ and docker-compose.yml at the root
Options considered: keep backend inside the Angular project; two separate repositories
Why I chose it: each app owns its build files and Docker context; one repo keeps docs, compose and both apps versioned together
What I'd reconsider at larger scale: separate repos (or a monorepo tool like Nx/Turborepo) when separate teams own and deploy each part independently
```

