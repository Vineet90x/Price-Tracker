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
│   ├── auth/                     # Auth service, guards, interceptors (Phase 1.5)
│   ├── models/                   # Shared TypeScript interfaces & types
│   └── services/                 # PriceService, WebSocketService (Phase 1 & 2)
│
├── features/                     # Feature domain pages & sub-components
│   ├── watchlist/                # Watchlist feature
│   │   ├── watchlist.ts          # Main watchlist page component
│   │   └── components/           # (Future: Search, StockCard, Chart, AlertModal)
│   └── portfolio/                # Portfolio feature
│       └── portfolio.ts          # Portfolio page component
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

##### A. Routing Table — [`src/app/app.routes.ts`](src/app/app.routes.ts)
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

##### B. Watchlist Feature Component — [`src/app/features/watchlist/watchlist.ts`](src/app/features/watchlist/watchlist.ts)
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

##### C. Portfolio Feature Component — [`src/app/features/portfolio/portfolio.ts`](src/app/features/portfolio/portfolio.ts)
- Standalone component holding the skeleton container for the user's asset holdings.

##### D. Root Layout & Navigation Header — [`src/app/app.ts`](src/app/app.ts) & [`src/app/app.html`](src/app/app.html)
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

##### A. Asset Domain Interface — [`src/app/core/models/stock.model.ts`](src/app/core/models/stock.model.ts)
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

##### B. Price Generator Service — [`src/app/core/services/price.service.ts`](src/app/core/services/price.service.ts)
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
- Connected `Watchlist` UI component ([`src/app/features/watchlist/watchlist.ts`](src/app/features/watchlist/watchlist.ts)) to render live ticking price cards.
- Used Angular 19 Control Flow (`@for ... track stock.symbol`) with `OnPush` change detection for max performance.

#### File Inventory & Code Walkthrough:

##### A. Watchlist UI Component — [`src/app/features/watchlist/watchlist.ts`](src/app/features/watchlist/watchlist.ts)
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
- Built standalone `StockChart` component ([`src/app/features/watchlist/components/stock-chart.ts`](src/app/features/watchlist/components/stock-chart.ts)) using HTML5 Canvas AreaSeries.
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
- [`.dockerignore`](.dockerignore): Prevents uploading host `node_modules/`, `.angular/` cache, and git history into the build context.
- [`nginx.conf`](nginx.conf): Custom Nginx web server config configured with SPA fallback (`try_files $uri $uri/ /index.html;`), gzip compression, and static asset caching.
- [`Dockerfile`](Dockerfile): Multi-stage container file:
  - **Stage 1 (Builder):** Uses `node:22-alpine` to install dependencies and run `npm run build -- --configuration production`.
  - **Stage 2 (Runtime):** Uses lightweight `nginx:alpine` (~25MB total image) to serve compiled static files on port 80.
- [`docker-compose.yml`](docker-compose.yml): Maps port `4200:80` for single-command startup.

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
| 1 | Bug | [price.service.ts:L223](src/app/core/services/price.service.ts#L223) | `toFixed(2)` on every tick | DOGE (0.175), ADA (0.62), MATIC (0.78) get rounded to 2 decimals: a 0.5% move is smaller than 0.01, so price freezes or jumps ~5% |
| 2 | Bug | [price.service.ts:L221](src/app/core/services/price.service.ts#L221) | `(Math.random() - 0.44) * 0.01` = −0.44%…+0.56%, mean +0.06%/tick | Compounds to roughly 4× per hour. Comment on L211/L220 is also wrong |
| 3 | Bug | [stock-chart.ts:L168](src/app/features/watchlist/components/stock-chart.ts#L168) vs [price.service.ts:L247](src/app/core/services/price.service.ts#L247) | Chart computes its own timestamp; service may bump time to `last+1` | Two sources of truth for time. After a symbol switch the chart can receive a time older than its last point and lightweight-charts throws |
| 4 | Design | [watchlist.ts:L315](src/app/features/watchlist/watchlist.ts#L315), [L358](src/app/features/watchlist/watchlist.ts#L358) | `getOrCreateAlertForm()` called from the template; it calls `setValidators` + `updateValueAndValidity` | Side effects inside change detection, re-run every tick |
| 5 | Logic | [watchlist.ts:L30-L38](src/app/features/watchlist/watchlist.ts#L30-L38) | Validator only blocks `target === current` (exact float equality on a moving price) | The real "fires instantly" case, e.g. "above 100" when price is already 120, is not blocked |
| 6 | Types | [watchlist.ts:L448](src/app/features/watchlist/watchlist.ts#L448), [L495](src/app/features/watchlist/watchlist.ts#L495) | Untyped `FormGroup` makes `form.value` `any` | `direction` could be `null` and TS won't catch it |
| 7 | UI bug | [app.html:L62](src/app/app.html#L62), [L108](src/app/app.html#L108) | `animate-in…`, `animate-[shrink_…]` | No animate plugin installed, no `@keyframes shrink` defined, so toast animations do nothing |
| 8 | Tests | [app.spec.ts](src/app/app.spec.ts) | Missing `provideRouter`; expects "Hello, price-tracker" | 0 working tests |
| 9 | Perf | [watchlist.ts:L244-L256](src/app/features/watchlist/watchlist.ts#L244-L256), [L267](src/app/features/watchlist/watchlist.ts#L267) | `alertCountForSymbol()` ×6 and `isCrypto()` (linear search) per card per tick | O(cards × universe) work every 1.5 s; matters in Step 7 (200 symbols) |
| 10 | Reactivity | [price.service.ts:L66](src/app/core/services/price.service.ts#L66), [L144](src/app/core/services/price.service.ts#L144) | `trackedAssets` / `currentPricesMap` are plain (non-signal) state read by templates | In a zoneless app the template only updates by coincidence; new card shows up to 1.5 s late |
| 11 | Arch | [app.ts:L16](src/app/app.ts#L16) | Root `App` injects `AlertService` → `PriceService` | Price feed + 25-symbol universe live in the main bundle and tick on `/portfolio` too. Acceptable (alerts are global), but a conscious trade-off |
| 12 | Arch | [angular.json:L31-L38](angular.json#L31-L38) vs [Dockerfile:L23](Dockerfile#L23) | SSR/Express configured, but prod serves only static files via nginx | `server.ts` is dead code in prod. Decide: `outputMode: "static"` or deploy Node SSR |
| 13 | Bundle | build output | Initial 555 kB > 500 kB budget | Likely PrimeNG + Aura theme in main bundle, used only for `<p-skeleton>` (not yet measured) |
| 14 | DevOps | [nginx.conf:L13-L21](nginx.conf#L13-L21) | `add_header` inside a `location` drops server-level headers | Security headers missing on JS/CSS; `X-XSS-Protection` is obsolete |
| 15 | DevOps | [Dockerfile:L8](Dockerfile#L8) | `npm ci … \|\| npm install …` | Silently hides lockfile drift; builds stop being reproducible |
| 16 | Style | [stock-chart.ts:L52-L53](src/app/features/watchlist/components/stock-chart.ts#L52-L53), L77/L149/L170 | Decorator `@Input`/`@ViewChild` + `as any` while the rest uses signals | Inconsistent; `as any` hides the `UTCTimestamp` type |
| 17 | Structure | [watchlist.ts](src/app/features/watchlist/watchlist.ts) | 551 lines, inline template, page + search + card + alert form in one component | Hard to read, test, and optimise; split into `search-box`, `stock-card`, `alert-form` |
| 18 | Minor | [alert.service.ts:L69](src/app/core/services/alert.service.ts#L69) | ID = `symbol-Date.now()` | Two alerts in the same ms collide; prefer `crypto.randomUUID()` |
