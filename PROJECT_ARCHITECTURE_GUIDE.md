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

##### A. Routing Table — [`src/app/app.routes.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/app.routes.ts)
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

##### B. Watchlist Feature Component — [`src/app/features/watchlist/watchlist.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts)
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

##### C. Portfolio Feature Component — [`src/app/features/portfolio/portfolio.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/features/portfolio/portfolio.ts)
- Standalone component holding the skeleton container for the user's asset holdings.

##### D. Root Layout & Navigation Header — [`src/app/app.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/app.ts) & [`src/app/app.html`](file:///home/alpha/Documents/Price-Tracker/src/app/app.html)
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

##### A. Asset Domain Interface — [`src/app/core/models/stock.model.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/core/models/stock.model.ts)
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

##### B. Price Generator Service — [`src/app/core/services/price.service.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/core/services/price.service.ts)
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
- Connected `Watchlist` UI component ([`src/app/features/watchlist/watchlist.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts)) to render live ticking price cards.
- Used Angular 19 Control Flow (`@for ... track stock.symbol`) with `OnPush` change detection for max performance.

#### File Inventory & Code Walkthrough:

##### A. Watchlist UI Component — [`src/app/features/watchlist/watchlist.ts`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts)
```typescript
@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [DatePipe, Skeleton],
  template: `
    <!-- Clean Live Streaming Badge -->
    <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-semibold">
      <span class="relative flex h-2 w-2">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
      </span>
      <span>LIVE FEED</span>
    </div>

    <!-- Live asset grid iterating over pricesSignal -->
    @for (stock of priceService.pricesSignal(); track stock.symbol) {
      <div [class.border-emerald-500/50]="stock.price > stock.previousPrice">
        <!-- Brand Gradient Logo Avatar -->
        <div [class]="getLogoBgClass(stock.symbol)">
          @switch (stock.symbol) {
            @case ('BTC') { <svg>...</svg> }
            @case ('ETH') { <svg>...</svg> }
            @default { <svg>...</svg> }
          }
        </div>
        <h3>{{ stock.name }}</h3>
        <span>{{ stock.price }}</span>
      </div>
    } @empty {
      <!-- PrimeNG Official Skeleton Component Loader -->
      <div class="col-span-full grid grid-cols-1 md:grid-cols-3 gap-4">
        <p-skeleton width="100%" height="160px" borderRadius="16px" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {
  readonly priceService = inject(PriceService);
}
```
- **Line 26:** Clean live feed pill with glowing status dot.
- **Line 33:** Asset cards display sleek brand gradient logos (Bitcoin gold, Ethereum indigo, Reliance blue, TCS purple, Infosys sky blue).
- **Line 41:** Integrated PrimeNG `<p-skeleton>` UI component for rendering smooth, accessible loading state skeletons.

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
- [`.dockerignore`](file:///home/alpha/Documents/Price-Tracker/.dockerignore): Prevents uploading host `node_modules/`, `.angular/` cache, and git history into the build context.
- [`nginx.conf`](file:///home/alpha/Documents/Price-Tracker/nginx.conf): Custom Nginx web server config configured with SPA fallback (`try_files $uri $uri/ /index.html;`), gzip compression, and static asset caching.
- [`Dockerfile`](file:///home/alpha/Documents/Price-Tracker/Dockerfile): Multi-stage container file:
  - **Stage 1 (Builder):** Uses `node:22-alpine` to install dependencies and run `npm run build -- --configuration production`.
  - **Stage 2 (Runtime):** Uses lightweight `nginx:alpine` (~25MB total image) to serve compiled static files on port 80.
- [`docker-compose.yml`](file:///home/alpha/Documents/Price-Tracker/docker-compose.yml): Maps port `4200:80` for single-command startup.

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

