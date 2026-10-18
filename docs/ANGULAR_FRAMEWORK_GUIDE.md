# Angular Framework Deep-Dive Guide

> **Purpose of this document:** A topic-by-topic reference guide explaining core Angular framework concepts used in this project. Each concept includes a simple real-world analogy, how Angular handles it internally, and direct links to the exact lines in our codebase where it is implemented.

---

## 💡 Table of Contents
1. [Standalone Components (`standalone: true`)](#1-standalone-components-standalone-true)
2. [`OnPush` Change Detection (`ChangeDetectionStrategy.OnPush`)](#2-onpush-change-detection-changedetectionstrategyonpush)
3. [Routing & Lazy Loading (`provideRouter`, `loadComponent`)](#3-routing--lazy-loading-providerouter-loadcomponent)
4. [Router Navigation Directives (`RouterOutlet`, `RouterLink`, `RouterLinkActive`)](#4-router-navigation-directives-routeroutlet-routerlink-routerlinkactive)
5. [Singleton Services (`@Injectable({ providedIn: 'root' })`)](#5-singleton-services-injectableprovidedin-root)
6. [RxJS Streams & Time Intervals (`interval`, `map`)](#6-rxjs-streams--time-intervals-interval-map)
7. [RxJS Multicasting (`shareReplay(1)`)](#7-rxjs-multicasting-sharereplay1)
8. [Angular Signals (`toSignal()`, `computed()`)](#8-angular-signals-tosignal-computed)
9. [Modern Template Control Flow (`@for (...; track ...)`)](#9-modern-template-control-flow-for--track-)
10. [Modern Dependency Injection (`inject()`)](#10-modern-dependency-injection-inject)
11. [Template Switch Syntax (`@switch / @case / @default`)](#11-template-switch-syntax-switch--case--default)
12. [PrimeNG UI Integration & Skeletons (`providePrimeNG`, `<p-skeleton>`)](#12-primeng-ui-integration--skeletons-provideprimeng-p-skeleton)
13. [Docker Multi-Stage Build & Nginx SPA Routing](#13-docker-multi-stage-build--nginx-spa-routing)
14. [Third-Party Canvas Integration & Safe SSR (`isPlatformBrowser`, `ElementRef`)](#14-third-party-canvas-integration--safe-ssr-isplatformbrowser-elementref)
15. [Tailwind v4 Design Tokens (`@theme`)](#15-tailwind-v4-design-tokens-theme)
16. [Signal Inputs & Outputs (`input()`, `input.required()`, `output()`)](#16-signal-inputs--outputs-input-inputrequired-output)
17. [`computed()` Equality Cut-off](#17-computed-equality-cut-off)
18. [Typed Reactive Forms (`FormControl<T>`, `nonNullable`)](#18-typed-reactive-forms-formcontrolt-nonnullable)
19. [Template Variables (`@let`)](#19-template-variables-let)
20. [`effect()` + `untracked()`](#20-effect--untracked)
21. [Restarting a CSS Animation per Tick](#21-restarting-a-css-animation-per-tick)
22. [CSS Layout Gotchas: `min-h-0` and `minmax(0,1fr)`](#22-css-layout-gotchas-min-h-0-and-minmax01fr)
23. [Abstract Class as DI Token + Factory Provider (Strategy pattern)](#23-abstract-class-as-di-token--factory-provider-strategy-pattern)
24. [HTTP: `provideHttpClient`, Functional Interceptors, Refresh-and-Retry](#24-http-providehttpclient-functional-interceptors-refresh-and-retry)
25. [Route Guards (`CanActivateFn`) + `provideAppInitializer`](#25-route-guards-canactivatefn--provideappinitializer)
26. [RxJS `webSocket()` + Reconnect with Backoff](#26-rxjs-websocket--reconnect-with-backoff)
27. [Batching a Fast Stream (`auditTime`)](#27-batching-a-fast-stream-audittime)
28. [`httpResource()`: HTTP as a Signal](#28-httpresource-http-as-a-signal)
29. [CDK Virtual Scrolling](#29-cdk-virtual-scrolling)
30. [`InjectionToken` with a Factory](#30-injectiontoken-with-a-factory)
31. [Per-Route Render Mode (`RenderMode.Client`) + Dev Proxy](#31-per-route-render-mode-rendermodeclient--dev-proxy)
32. [`afterRenderEffect` + Loading a Third-Party Script (Google button)](#32-afterrendereffect--loading-a-third-party-script-google-button)




---

## 1. Standalone Components (`standalone: true`)

### Plain English Explanation
Think of a Standalone Component as a **self-contained tool kit**. Before Angular 14+, components had to belong to a "toolbox" called an `NgModule`. If Component A wanted to use Component B, both had to be registered in the same `NgModule`. 

With **Standalone Components**, a component manages its own dependencies. If it needs a button or an input directive, it lists it directly in its `@Component({ imports: [...] })` array.

### How Angular Handles It Behind the Scenes
Angular's compiler inspects the `imports` array of the standalone component and links only those specific dependencies at compile time. This enables precise code splitting and tree-shaking, meaning unused Angular modules are automatically stripped out of the production JavaScript bundle.

### Where Used in Our Codebase:
- [`src/app/features/watchlist/watchlist.ts:L34`](../frontend/src/app/features/watchlist/watchlist.ts#L34)
- [`src/app/features/watchlist/components/watchlist-row.ts:L12-L14`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L12-L14), [`src/app/features/watchlist/components/alert-panel.ts:L39-L41`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L39-L41) (new in UI R4/R6)
- [`src/app/features/portfolio/portfolio.ts:L23`](../frontend/src/app/features/portfolio/portfolio.ts#L23)
- [`src/app/app.ts:L18`](../frontend/src/app/app.ts#L18)

```typescript
@Component({
  selector: 'app-watchlist',
  standalone: true, // Tells Angular this component is self-contained
  imports: [DatePipe], // Dependencies imported directly here
  ...
})
export class Watchlist {}
```

---

## 2. `OnPush` Change Detection (`ChangeDetectionStrategy.OnPush`)

### Plain English Explanation
Imagine a teacher checking 30 students in a classroom every 5 seconds to see if anyone raised their hand (Default Change Detection). It takes a lot of energy! 

Now imagine the teacher tells the class: *"Don't raise your hand unless an alarm goes off on your desk or I hand you a new paper"* (`OnPush` Change Detection). The teacher saves tons of energy and only checks students when something explicitly changes!

### How Angular Handles It Behind the Scenes
Angular runs a global Change Detection loop whenever async events occur (click handlers, timer intervals, HTTP responses). 
- Under **`Default`**, Angular re-evaluates expressions across **the entire component tree**.
- Under **`OnPush`**, Angular skips re-checking the component and its children unless:
  1. An `@Input()` property reference changes.
  2. An event handler inside the component template fires (e.g. `(click)`).
  3. A Signal read in the template emits a new value.
  4. An `Observable` template pipe (`| async`) emits a new value.

### Why It's Critical For Our Project:
When streaming live financial prices ticking every 1.5s, `Default` change detection would re-evaluate the entire page DOM every tick, causing micro-stutters. `OnPush` guarantees extreme rendering efficiency!

### Where Used in Our Codebase:
- [`src/app/features/watchlist/watchlist.ts:L218`](../frontend/src/app/features/watchlist/watchlist.ts#L218)
- [`src/app/features/watchlist/components/watchlist-row.ts:L58`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L58), [`src/app/features/watchlist/components/alert-panel.ts:L126`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L126). Why it matters most in the row: see §21
- [`src/app/features/portfolio/portfolio.ts:L75`](../frontend/src/app/features/portfolio/portfolio.ts#L75)
- [`src/app/app.ts:L22`](../frontend/src/app/app.ts#L22)

---

## 3. Routing & Lazy Loading (`provideRouter`, `loadComponent`)

### Plain English Explanation
Imagine ordering a 5-course dinner at a restaurant. Instead of bringing all 5 courses to your table at once (which makes the table crowded and your food cold), the kitchen brings each course only when you're ready to eat it.

That is **Lazy Loading**. The browser downloads the core shell first (`main.js`). When you click on `/portfolio`, it dynamically downloads `chunk-portfolio.js` just in time.

### How Angular Handles It Behind the Scenes
`loadComponent: () => import('./path').then(m => m.Component)` uses standard JavaScript dynamic imports. Build tools (esbuild/webpack) split dynamic imports into separate `.js` chunk files during build time.

### Where Used in Our Codebase:
- [`src/app/app.routes.ts:L5-L12`](../frontend/src/app/app.routes.ts#L5-L12)

```typescript
export const routes: Routes = [
  { path: '', redirectTo: 'watchlist', pathMatch: 'full' },
  {
    path: 'watchlist',
    loadComponent: () =>
      import('./features/watchlist/watchlist').then((m) => m.Watchlist),
  },
  ...
];
```

---

## 4. Router Navigation Directives (`RouterOutlet`, `RouterLink`, `RouterLinkActive`)

### Plain English Explanation
In standard HTML websites, clicking `<a href="/watchlist">` sends a request to the server, screen turns white, and reloads the whole page.

In an Angular Single Page Application (SPA):
1. **`RouterLink`**: Intercepts the click, prevents full browser refresh, and updates the browser URL bar instantly using HTML5 PushState.
2. **`RouterOutlet`**: A designated target placeholder `<router-outlet />` where Angular inserts or swaps out the component template corresponding to the current URL.
3. **`RouterLinkActive`**: Automatically attaches CSS classes to the active menu item so the user visually knows which tab they are currently viewing.

### Where Used in Our Codebase:
- Import declaration: [`src/app/app.ts:L119`](../frontend/src/app/app.ts#L19)
- HTML usage: nav links [`src/app/app.html:L15-L24`](../frontend/src/app/app.html#L15-L24), outlet [`src/app/app.html:L54`](../frontend/src/app/app.html#L54)

### Styling the active link: `ariaCurrentWhenActive` (UI R2)
`routerLinkActive="some classes"` adds classes, but those classes compete with the link's base classes
(e.g. `text-ink-muted` vs `text-ink`). Both are single-class selectors, so the winner is whichever Tailwind
happened to write **later in the CSS file**, not the order in your HTML.

We instead write `routerLinkActive ariaCurrentWhenActive="page"`. The router sets `aria-current="page"` on the
active link, and Tailwind's `aria-[current=page]:text-ink` variant compiles to `.x[aria-current=page]`:
a class **plus** an attribute selector, which has higher specificity and always wins. Bonus: screen readers announce "current page".
`routerLinkActive` stays on the element (with no classes) because it is the directive that toggles `aria-current`.

### Common Mistakes
- `path: ''` routes and `routerLinkActive`: `/` is a prefix of every URL, so a link to `/` looks active everywhere unless you pass `[routerLinkActiveOptions]="{ exact: true }"`.
- Forgetting to add `RouterLink` / `RouterLinkActive` to the standalone component's `imports`: the attribute silently becomes a plain HTML attribute (strictTemplates catches unknown *bindings*, not unknown plain attributes).

---

## 5. Singleton Services (`@Injectable({ providedIn: 'root' })`)

### Plain English Explanation
Imagine a building with a single water tank on the roof that supplies water to every apartment. No matter which apartment turns on a tap, they are receiving water from the **exact same central supply**.

`@Injectable({ providedIn: 'root' })` tells Angular to create **one single instance** of the service across the entire application lifetime. Whether 5 different components request `PriceService`, Angular gives them all the exact same object instance.

### Where Used in Our Codebase:
- [`src/app/core/services/price.service.ts:L25`](../frontend/src/app/core/services/price.service.ts#L25)

```typescript
@Injectable({
  providedIn: 'root', // Registered in root injector as a global singleton
})
export class PriceService { ... }
```

---

## 6. RxJS Streams & Time Intervals (`interval`, `map`)

### Plain English Explanation
Think of an RxJS Observable like a **conveyor belt in a factory**.
- `interval(1500)` acts as an automatic timer that places a ping on the conveyor belt every 1.5 seconds.
- `map(...)` acts as a worker standing along the conveyor belt who transforms each ping into an updated list of stock prices.

### Where Used in Our Codebase:
- Since Phase 2 the `interval` lives only in the **simulated** feed (`?feed=sim`, `?scale=N`): [`src/app/core/services/simulated-price-feed.ts:L26`](../frontend/src/app/core/services/simulated-price-feed.ts#L26)
- The live feed is a WebSocket stream instead (§26). `PriceService` doesn't care which one it gets: it pipes `feed.events$` through `tap → auditTime → map` ([`src/app/core/services/price.service.ts:L62-L68`](../frontend/src/app/core/services/price.service.ts#L62-L68)).

---

## 7. RxJS Multicasting (`shareReplay(1)`)

### Plain English Explanation
Imagine a TV live broadcast of a football match. If 1,000 people turn on their TVs to watch the match, the stadium does **not** play 1,000 separate games! Instead, **one single match** is played, and the signal is broadcasted (multicasted) to all viewers.

Without `shareReplay(1)`, every time a new component subscribes to `prices$` (the watchlist via `toSignal`, `AlertService`, the chart), the whole pipeline would run once **per subscriber**: three timers / three socket listeners doing the same work.

With `shareReplay(1)`:
1. Only **one central timer** runs.
2. The `(1)` parameter remembers the **latest calculated price array**, so any component that joins late instantly receives the current market prices without waiting for the next tick.

### Where Used in Our Codebase:
- Second use, same idea: [`src/app/core/auth/auth.service.ts:L102`](../frontend/src/app/core/auth/auth.service.ts#L102) makes five simultaneous 401s share **one** `/api/auth/refresh` call (§24).
- [`src/app/core/services/price.service.ts:L68`](../frontend/src/app/core/services/price.service.ts#L68)

---

## 8. Angular Signals (`toSignal()`, `computed()`)

### Plain English Explanation
Imagine a spreadsheet cell (A1) with number `10`, and cell B1 with formula `=A1 * 2`. Whenever you change A1 to `20`, cell B1 updates to `40` automatically. 

That is **Signals**:
- `toSignal(stream$)`: Converts a continuous RxJS Observable stream into a Signal getter function `pricesSignal()`.
- `computed(() => ...)`: Creates a derived signal cell (like `gainersCount()`) that recalculates automatically whenever `pricesSignal()` updates.

### Where Used in Our Codebase:
- Stream conversion: [`src/app/core/services/price.service.ts:L71`](../frontend/src/app/core/services/price.service.ts#L71)
- Derived state: [`src/app/core/services/price.service.ts:L72-L74`](../frontend/src/app/core/services/price.service.ts#L72-L74)

---

## 9. Modern Template Control Flow (`@for (...; track ...)`)

### Plain English Explanation
In older Angular versions, rendering lists required `*ngFor="let item of items; trackBy: trackFn"`. 

In Angular 17+, built-in control flow syntax `@for (item of items; track item.id)` is built directly into the template compiler. 
- The mandatory `track` expression acts like a **label tag** on each row. When item #2 updates, Angular changes only row #2 in the DOM instead of re-rendering the entire list!

### Where Used in Our Codebase:
- [`src/app/features/watchlist/watchlist.ts:L162`](../frontend/src/app/features/watchlist/watchlist.ts#L162)

---

## 10. Modern Dependency Injection (`inject()`)

### Plain English Explanation
Before Angular 14, to get a service inside a component, you had to write a verbose constructor:
```typescript
// Legacy approach
constructor(private priceService: PriceService) {}
```

Modern Angular provides the functional `inject(PriceService)` function:
```typescript
// Modern approach
readonly priceService = inject(PriceService);
```
It can be assigned directly to class properties, making code cleaner and easier to test.

### Where Used in Our Codebase:
- [`src/app/features/watchlist/watchlist.ts:L221-L222`](../frontend/src/app/features/watchlist/watchlist.ts#L221-L222)
- [`src/app/features/watchlist/components/watchlist-row.ts:L66`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L66), [`src/app/features/watchlist/components/alert-panel.ts:L133`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L133)

---

## 11. Template Switch Syntax (`@switch / @case / @default`)

### Plain English Explanation
In older Angular versions, rendering conditional branches based on a string value required legacy directives like `[ngSwitch]="symbol" *ngSwitchCase="'BTC'"`.

In Angular 17+, the `@switch` control flow block works just like a native JavaScript `switch` statement directly inside HTML templates:
```html
@switch (symbol) {
  @case ('BTC') { <svg>Bitcoin Icon</svg> }
  @case ('ETH') { <svg>Ethereum Icon</svg> }
  @default { <svg>Generic Icon</svg> }
}
```

### Where Used in Our Codebase:
- **No longer used.** The `@switch` that picked a logo per symbol was removed in UI R4 (trading terminals show tickers, not logos). Kept here because you'll meet it again; the closest thing we still use is the `@if / @else if` chain in [`src/app/features/watchlist/components/alert-panel.ts:L105-L115`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L105-L115).

---

## 12. PrimeNG UI Integration & Skeletons (`providePrimeNG`, `<p-skeleton>`)

### Plain English Explanation
Think of **PrimeNG** as a pre-fabricated blueprint library for high-end UI widgets (Buttons, Modals, Skeleton Loaders, Tables, Charts). 

Instead of manually styling placeholder loader boxes using custom CSS, PrimeNG provides `<p-skeleton>`:
- Provides built-in shimmer wave animations.
- Fully accessible and responsive.
- Configured globally via `providePrimeNG({ theme: { preset: Aura } })` in `app.config.ts`.

### Where Used in Our Codebase:
- Global configuration: [`src/app/app.config.ts:L19-L29`](../frontend/src/app/app.config.ts#L19-L29). `darkModeSelector: '.app-dark'` ([L25](../frontend/src/app/app.config.ts#L25)) + `<html class="app-dark">` ([index.html:L2](../frontend/src/index.html#L2)) force PrimeNG's dark tokens regardless of the OS theme.
- Component import: [`src/app/features/watchlist/watchlist.ts:L16`](../frontend/src/app/features/watchlist/watchlist.ts#L16)
- Template usage: [`src/app/features/watchlist/watchlist.ts:L142-L146`](../frontend/src/app/features/watchlist/watchlist.ts#L142-L146) (row placeholders), [`src/app/features/watchlist/watchlist.ts:L196`](../frontend/src/app/features/watchlist/watchlist.ts#L196) (header placeholder). `styleClass="bg-surface-2!"`: the trailing `!` is Tailwind v4's `!important`, needed to beat PrimeNG's own background.

---

## 13. Docker Multi-Stage Build & Nginx SPA Routing

### Plain English Explanation
Think of compiling an Angular app like baking a cake.
1. You need a large kitchen with heavy mixers, bowls, ovens, and raw ingredients (**Stage 1: Node.js Builder Container**).
2. But when serving the cake to customers, you don't bring the heavy oven and mixer to the customer's table! You only bring the finished cake on a small, elegant plate (**Stage 2: Lightweight Nginx Container**).

This is why a **Multi-Stage Dockerfile** is the industry standard:
- Node.js builds the app (`npm run build`).
- Only the compiled HTML/JS/CSS output is copied into Nginx (`nginx:alpine`), leaving behind heavy development tools. Result: Image size shrinks from ~1.2GB down to ~25MB!

### Why `try_files $uri $uri/ /index.html;` is Required:
In a traditional multi-page website, visiting `/portfolio` looks for a folder named `portfolio/index.html` on the hard drive. 
In Angular SPAs, `/portfolio` is a **virtual client-side route**. Nginx must be configured to catch all non-file URLs and deliver `index.html`, allowing Angular's client router to render the correct view without a 404 error!

### Where Used in Our Codebase:
- Nginx configuration: [`nginx.conf:L8-L10`](../frontend/nginx.conf#L8-L10)
- Multi-stage Dockerfile: [`Dockerfile:L1-L24`](../frontend/Dockerfile#L1-L24)
- Docker Compose: [`docker-compose.yml:L1-L9`](../docker-compose.yml#L1-L9)

---

## 14. Third-Party Canvas Integration & Safe SSR (`isPlatformBrowser`, `ElementRef`)

### Plain English Explanation
Think of Server-Side Rendering (SSR) as an artist sketching your web page on paper inside a server warehouse before sending it to you.
- Normal HTML text and buttons can easily be sketched on paper.
- But an interactive **HTML5 `<canvas>`** drawing library (like TradingView) needs a real screen, mouse cursor, and graphics card to draw!
- If the server tries to run `createChart()`, it immediately crashes with `ReferenceError: window is not defined` because servers don't have windows or screens.

### How `isPlatformBrowser(platformId)` Solves This:
Angular provides `PLATFORM_ID` to check where the code is executing:
```typescript
private readonly platformId = inject(PLATFORM_ID);

ngAfterViewInit(): void {
  // Only execute canvas chart initialization if running in the user's browser!
  if (!isPlatformBrowser(this.platformId)) {
    return;
  }
  this.initChart();
}
```

### Where Used in Our Codebase:
- SSR Guard: [`src/app/features/watchlist/components/stock-chart.ts:L65-L67`](../frontend/src/app/features/watchlist/components/stock-chart.ts#L65-L67)
- Canvas Element Reference: [`src/app/features/watchlist/components/stock-chart.ts:L45`](../frontend/src/app/features/watchlist/components/stock-chart.ts#L45)
- Resizing: our own `ResizeObserver` was **removed** in UI R5. `autoSize: true` ([`src/app/features/watchlist/components/stock-chart.ts:L105`](../frontend/src/app/features/watchlist/components/stock-chart.ts#L105)) makes lightweight-charts observe the container itself and resize both width and height.
- Reading CSS design tokens from JS for the canvas: [`src/app/features/watchlist/components/stock-chart.ts:L92-L100`](../frontend/src/app/features/watchlist/components/stock-chart.ts#L92-L100) (see §15)





---

## Step 5 Concepts — RxJS Search Operators

### `FormControl` (Reactive Forms)
A `FormControl` is Angular's way of tracking the value and state of a single form input.

```typescript
// Import
import { FormControl, ReactiveFormsModule } from '@angular/forms';

// Create
readonly searchControl = new FormControl('');  // '' = initial value

// In template — binds input to control
<input [formControl]="searchControl" />

// Access current value anywhere
this.searchControl.value       // current value
this.searchControl.valueChanges  // Observable that emits on every change
```

**Why not `[(ngModel)]`?** `FormControl` gives you an Observable stream via `.valueChanges`, which you can pipe through RxJS operators. `ngModel` doesn't.

---

### `debounceTime(ms)` — Wait for the user to stop typing
```typescript
import { debounceTime } from 'rxjs/operators';

searchControl.valueChanges.pipe(
  debounceTime(300)   // Only emit if 300ms pass with no new value
)
```

**Without it:** every keystroke triggers a search → 'b', 'bi', 'bit', 'bitc', 'bitcoi', 'bitcoin' = 7 searches.
**With it:** only 'bitcoin' triggers — 300ms after typing stops.

**Analogy:** Like "call me back when you're done thinking" — you only respond when the other person pauses.

---

### `switchMap` vs `mergeMap` — The Critical Difference

Both operators transform each emission into a new inner Observable. The difference is what happens when a NEW emission arrives while the previous inner Observable is still running:

| Operator | Behaviour | Use when |
|----------|-----------|----------|
| `switchMap` | **Cancels** the previous inner Observable, starts fresh | Only the latest result matters (search, autocomplete) |
| `mergeMap` | **Keeps all** inner Observables running in parallel | Each result matters independently (parallel tasks) |
| `concatMap` | **Queues** — waits for previous to finish before starting next | Order matters, no loss (file uploads) |

**The bug `mergeMap` causes in search:**
```
User types: 'bit' → 'bitcoin' (fast)
  mergeMap: search('bit') starts (slow)   → result arrives LAST: ['Bitcoin']
            search('bitcoin') starts (fast) → result arrives FIRST: ['Bitcoin', 'Binance']

Final result shown: ['Bitcoin']   ← WRONG! Older slower result overwrote the newer one.
```

**`switchMap` fixes it:**
```
User types: 'bit' → 'bitcoin' (fast)
  switchMap: search('bit') starts
             'bitcoin' arrives → search('bit') CANCELLED
             search('bitcoin') starts → result: ['Bitcoin', 'Binance']

Final result shown: ['Bitcoin', 'Binance']   ← CORRECT!
```

In our app, `searchSymbols()` is synchronous so there's no race visible right now. In Phase 2, when it becomes `http.get('/search?q=' + term)`, this cancellation becomes critical — and the component code won't change at all.

---

### `startWith(value)` — Give a stream an initial emission
```typescript
import { startWith } from 'rxjs/operators';

// Without startWith: valueChanges only emits when input changes
// toSignal gets undefined until first keystroke

// With startWith: immediately emits '' then proceeds normally
searchControl.valueChanges.pipe(
  startWith('')   // ← emits '' right away
)
```
Used here because `toSignal()` requires at least one emission to set an initial signal value.

---

## 15. Tailwind v4 Design Tokens (`@theme`)

### Plain English Explanation
A design token is a **named decision**: "the up colour is `#16c784`". You write `text-up` everywhere instead of the raw colour.
Think of a paint shop's labelled tins: you ask for "Wall Grey", not a pigment formula. To repaint the whole house you change the formula on one tin.

### How It Works Behind the Scenes
Tailwind v4 has no `tailwind.config.js`. Configuration lives in CSS:
- Inside `@theme { --color-up: #16c784; }`, the **namespace** of a variable decides which utilities get generated: `--color-*` → `text-*`, `bg-*`, `border-*`, `ring-*` …; `--font-*` → `font-*`; `--animate-*` → `animate-*`.
- Every token is **also** emitted as a real CSS variable on `:root`. So plain JavaScript can read it: `getComputedStyle(document.documentElement).getPropertyValue('--color-up')`. That matters for canvas libraries like `lightweight-charts`, which can't use CSS classes.
- Tailwind scans your source files for class names and generates **only the CSS you use**. The same goes for `@keyframes` defined in `@theme`: they're emitted only when a used class (e.g. `animate-flash-up`) references them.
- `@apply bg-surface-0 text-ink` inside normal CSS copies the utilities' declarations into that rule.

### Where Used in Our Codebase
- [styles.css:L10-L70](../frontend/src/styles.css#L10-L70): the `@theme static` block (colours, fonts, animations)
- [styles.css:L72-L74](../frontend/src/styles.css#L72-L74): `body { @apply … }`
- Read from JS by the chart: [`src/app/features/watchlist/components/stock-chart.ts:L92-L100`](../frontend/src/app/features/watchlist/components/stock-chart.ts#L92-L100)

### Common Mistakes
- Putting tokens in `:root {}` instead of `@theme {}`: you get the variable but **no utility classes**.
- Building class names dynamically (`'text-' + color`): Tailwind's scanner can't see them, so the CSS is never generated. Always write full class names in source.
- Expecting keyframes to exist just because they're defined: they're tree-shaken until a class uses them.
- Same for the variables: plain `@theme` emits only variables some class uses. If JS reads a token via `getComputedStyle`, use `@theme static` (we hit this in UI R5: `--color-warn` was missing).
- Tailwind scans the **whole project**, including these `.md` guides. Old class names inside code snippets in the docs (e.g. `bg-slate-900`) still generate CSS. Harmless but slightly wasteful; `@source not "../*.md";` would exclude them.

---

## 16. Signal Inputs & Outputs (`input()`, `input.required()`, `output()`)

### Plain English Explanation
A component's inputs are its **function parameters**; its outputs are the **events it can fire**.
`input()` makes each parameter a read-only signal: you read it as `stock()`, and anything built from it (`computed`) updates automatically when the parent passes a new value.

### How Angular Handles It Behind the Scenes
- When the parent template binds `[stock]="stock"`, Angular writes the new value into the input signal during change detection, and every `computed`/template that read `stock()` is marked stale.
- `input.required<T>()`: the compiler errors if the parent forgets the binding. The old style needed `@Input({ required: true })` plus a `!` in the type.
- `output<T>()` returns an emitter; `(selectSymbol)="..."` in the parent listens to it. Unlike `@Output() x = new EventEmitter()`, it isn't an RxJS Subject.
- No `ngOnChanges(changes: SimpleChanges)` needed: a `computed` or `effect` reacts to the input directly.

### Where Used in Our Codebase
- [`src/app/features/watchlist/components/watchlist-row.ts:L61-L64`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L61-L64): `stock` (required), `selected`, `alertCount`, and the `selectSymbol` output
- [`src/app/features/watchlist/components/alert-panel.ts:L129-L131`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L129-L131): `symbol`, `price`, `currency`
- Parent bindings: [`src/app/features/watchlist/watchlist.ts:L27-L158`](../frontend/src/app/features/watchlist/watchlist.ts#L27-L158), [`src/app/features/watchlist/watchlist.ts:L29`](../frontend/src/app/features/watchlist/watchlist.ts#L29)
- Still on decorators (not migrated yet, Backlog #16): [`src/app/features/watchlist/components/stock-chart.ts:L44-L45`](../frontend/src/app/features/watchlist/components/stock-chart.ts#L44-L45)

### Common Mistakes
- Naming an output like a native DOM event (`select`, `click`): the parent's listener can also catch the native event bubbling up from inside. That's why ours is `selectSymbol`.
- Trying to `.set()` an input: inputs are read-only inside the component.

---

## 17. `computed()` Equality Cut-off

### Plain English Explanation
A `computed` only tells its readers "I changed" when its **new value differs** from the old one (`Object.is`). So a computed can work as a **filter** that stops change from spreading further.

### Where Used in Our Codebase
[`src/app/features/watchlist/components/watchlist-row.ts:L73-L75`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L73-L75):
```ts
private readonly symbol = computed(() => this.stock().symbol);   // re-runs every tick
readonly currency = computed(() => (this.priceService.isCrypto(this.symbol()) ? '$' : '₹')); // does NOT
```
Every tick `stock()` is a brand-new object, so `symbol` re-runs. But it returns the **same string** (`'BTC' === 'BTC'`), so `currency` isn't marked stale and `isCrypto()` (a linear search over 25 assets) is skipped.
If `currency` read `this.stock().symbol` directly, it would re-run on every tick for every row. This was half of Backlog #9.

The other half: [alert.service.ts:L40-L46](../frontend/src/app/core/services/alert.service.ts#L40-L46) builds a `Map` of alert counts **only when alerts change**. Each row does one `Map.get` instead of filtering the alert list 6 times per tick.

### Common Mistakes
- Returning a new object or array every time (`{ a: x }`, `.filter(...)`): a new reference is never `Object.is`-equal, so there's no cut-off. Return primitives, or pass an `equal` function to `computed`.

---

## 18. Typed Reactive Forms (`FormControl<T>`, `nonNullable`)

### Plain English Explanation
Since Angular 14, `new FormControl<number | null>(null)` knows its value type, and TypeScript checks every `.value` you read.

### Where Used in Our Codebase
[`src/app/features/watchlist/components/alert-panel.ts:L140-L147`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L140-L147):
- `direction: new FormControl<Direction>('above', { nonNullable: true })`. `nonNullable` means `reset()` goes back to `'above'`, not `null`, so the type is `Direction`, not `Direction | null`.
- `targetPrice: new FormControl<number | null>(null, …)`. `<input type="number">` gives a `number`, or `null` when empty.
- `submit()` ([`src/app/features/watchlist/components/alert-panel.ts:L158`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L158)) checks `target === null` before `addAlert`, so TS knows it's a `number`. The old untyped `FormGroup` made `form.value` `any` (Backlog #6, fixed).

### Validators that need live data
[`src/app/features/watchlist/components/alert-panel.ts:L29-L35`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L29-L35): the validator takes a **getter** `() => number`, so it reads the latest price whenever it runs. The old code captured a plain number and therefore had to call `setValidators()` from the template on every tick to refresh it. That was a side effect during rendering (Backlog #4, fixed).

### Common Mistakes
- `form.value` skips **disabled** controls; use `form.getRawValue()` if you need them.
- `FormGroup` without types (or `UntypedFormGroup`) silently brings back `any`.

---

## 19. Template Variables (`@let`)

### Plain English Explanation
`@let name = expression;` gives a long template expression a short name, like `const` in TypeScript.

### Where Used in Our Codebase
[`src/app/features/watchlist/components/alert-panel.ts:L72`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L72): `@let tp = form.controls.targetPrice;` and then `tp.touched && tp.invalid`, instead of repeating `form.controls.targetPrice` six times. The old code called a component method `getAlertFormControl(...)` about 8 times per card per render.

### Common Mistakes
- `@let` is read-only and scoped to its block; you can't assign to it from an event handler.

---

## 20. `effect()` + `untracked()`

### Plain English Explanation
`effect(fn)` runs `fn`, remembers which signals it read, and re-runs it when any of them change. Use it to **sync signals to the outside world** (DOM, forms, localStorage), not to compute values (that's `computed`).
`untracked(fn)` runs code inside an effect **without** recording its signal reads as dependencies.

### Where Used in Our Codebase
[`src/app/features/watchlist/components/alert-panel.ts:L152-L155`](../frontend/src/app/features/watchlist/components/alert-panel.ts#L152-L155):
```ts
effect(() => {
  this.symbol();                                                 // trigger: re-run when the symbol changes
  untracked(() => this.form.controls.targetPrice.reset(null));   // action: not a dependency
});
```
When you pick another symbol, the half-typed target for the old one is cleared.

### Common Mistakes
- Writing to a signal inside an effect that also reads it: loop risk. Separating "trigger" from "action" with `untracked` avoids it.
- Using `effect` to derive state (`effect(() => this.b.set(this.a() * 2))`): use `computed`.

---

## 21. Restarting a CSS Animation per Tick

### Plain English Explanation
A CSS animation plays **once, when its class is first applied**. If BTC rises two ticks in a row, the class stays `animate-flash-up` and the second flash never plays.

### How We Solve It
[`src/app/features/watchlist/components/watchlist-row.ts:L44-L48`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L44-L48):
```html
@for (tick of [stock().updatedAt]; track tick) {
  <div [class]="flashClass()">…price…</div>
}
```
A one-item loop tracked by `updatedAt` (a new `Date` each tick). A new track key makes Angular **destroy and recreate** that `<div>`, and a new element starts its animation from the beginning.
Cost: one small DOM node per row per tick. Fine for 25 rows. At 200+ rows (Step 7) we'd measure it; the alternative is the Web Animations API (`element.animate(...)`) called from an effect.

`motion-safe:` (in `motion-safe:animate-flash-up`) skips the animation for users who turned on "reduce motion" in their OS.

---

## 22. CSS Layout Gotchas: `min-h-0` and `minmax(0,1fr)`

### Plain English Explanation
Flex and grid children default to "never smaller than my content". That breaks scrollable panes and resizable charts.

| Problem | Fix | Where |
|---|---|---|
| Flex child won't shrink, so its `overflow-auto` never scrolls | `min-h-0` (overrides `min-height: auto`) | [app.html:L53](../frontend/src/app/app.html#L53), [`src/app/features/watchlist/watchlist.ts:L58`](../frontend/src/app/features/watchlist/watchlist.ts#L58) |
| Grid column `1fr` is really `minmax(auto, 1fr)` and won't shrink below the chart canvas | `minmax(0,1fr)` | [`src/app/features/watchlist/watchlist.ts:L52-L55`](../frontend/src/app/features/watchlist/watchlist.ts#L52-L55) |
| `h-full` inside a parent with **auto** height resolves to 0 | Fixed height on mobile (`h-80`), fill only on desktop (`lg:flex-1`) | [`src/app/features/watchlist/watchlist.ts:L201`](../frontend/src/app/features/watchlist/watchlist.ts#L201) |

---

## 23. Abstract Class as DI Token + Factory Provider (Strategy pattern)

### Plain English Explanation
A wall socket doesn't care whether the power comes from solar or the grid; anything with the right plug works.
`PriceService` asks for "a `PriceFeed`" (the plug shape) and Angular hands it whichever implementation the app was configured with.

### How It Works
- TypeScript interfaces vanish at runtime, so they can't be DI tokens. An **abstract class** survives compilation, so it can be both the *type* and the *token*: [`src/app/core/services/price-feed.ts:L28`](../frontend/src/app/core/services/price-feed.ts#L28).
- Three implementations: [`src/app/core/services/websocket-price-feed.ts:L18`](../frontend/src/app/core/services/websocket-price-feed.ts#L18) (live), [`src/app/core/services/simulated-price-feed.ts:L17`](../frontend/src/app/core/services/simulated-price-feed.ts#L17) (offline / scale test), [`src/app/core/services/price-feed.ts:L36`](../frontend/src/app/core/services/price-feed.ts#L36) (server prerender).
- A **factory provider** chooses one at startup: [`src/app/core/services/price-feed.provider.ts:L15-L21`](../frontend/src/app/core/services/price-feed.provider.ts#L15-L21). `new SimulatedPriceFeed()` inside a factory still runs in an injection context, so the class's own `inject()` calls work.
- Registered once in [`src/app/app.config.ts:L31`](../frontend/src/app/app.config.ts#L31).

### Why it matters here
This is the payoff the build guide promised for Phase 2: replacing the fake feed with a real one changed **zero components**. Tests use the same seam: [`src/app/core/services/price.service.spec.ts:L8`](../frontend/src/app/core/services/price.service.spec.ts#L8) is a hand-driven fake feed.

### Common Mistakes
- `providers: [PriceFeed]` with an abstract class → "cannot instantiate". You must say *which* implementation (`useClass` / `useFactory`).

---

## 24. HTTP: `provideHttpClient`, Functional Interceptors, Refresh-and-Retry

### Plain English Explanation
An interceptor is a **mail room** every outgoing request passes through. Ours stamps each letter with your ID badge (the access token). If a letter comes back "badge expired" (401), the mail room gets a new badge (refresh) and resends the letter **once**.

### How It Works
- [`src/app/app.config.ts:L30`](../frontend/src/app/app.config.ts#L30): `withFetch()` uses the browser's `fetch` (recommended with SSR); `withInterceptors([...])` registers plain functions, which run in order.
- [`src/app/core/auth/auth.interceptor.ts:L25`](../frontend/src/app/core/auth/auth.interceptor.ts#L25): an `HttpInterceptorFn` is `(req, next) => Observable`. Requests are immutable, so we `req.clone({ setHeaders })`.
- On 401 ([`src/app/core/auth/auth.interceptor.ts:L36-L43`](../frontend/src/app/core/auth/auth.interceptor.ts#L36-L43)): `auth.refresh()` → `switchMap` to `next(retried request)`. The retry is *outside* the `catchError` that handles the original 401, so a second 401 is passed to the caller instead of looping forever.
- **Refresh de-duplication** ([`src/app/core/auth/auth.service.ts:L93-L105`](../frontend/src/app/core/auth/auth.service.ts#L93-L105)): `refreshInFlight ??= …shareReplay(1)` means concurrent 401s join the same request; `finalize` clears it afterwards. Tested in `auth.interceptor.spec.ts` ("two requests failing at once share ONE refresh call").
- The access token is a private signal ([`src/app/core/auth/auth.service.ts:L42`](../frontend/src/app/core/auth/auth.service.ts#L42)) – memory only. The refresh token is an httpOnly cookie that JavaScript can't read at all.

### Common Mistakes
- Calling `inject()` inside the `pipe` callbacks (after an async boundary): inject only at the top of the interceptor function.
- Adding the token to *every* URL: ours only touches `/api/…`, never third-party hosts.
- Retrying refresh failures: if `/refresh` itself returns 401, the session is over; log out.

---

## 25. Route Guards (`CanActivateFn`) + `provideAppInitializer`

### Plain English Explanation
A guard is a **doorman** for a route. `authGuard` lets you into `/portfolio` only if you're logged in; otherwise it sends you to `/login?returnUrl=/portfolio`.

### How It Works
- [`src/app/core/auth/auth.guards.ts:L9-L12`](../frontend/src/app/core/auth/auth.guards.ts#L9-L12): return `true` to allow, or a `UrlTree` to redirect (better than calling `router.navigate` yourself, because the router can cancel cleanly).
- [`src/app/core/auth/auth.guards.ts:L15-L18`](../frontend/src/app/core/auth/auth.guards.ts#L15-L18): the reverse, for `/login`.
- Wired in [`src/app/app.routes.ts:L13`](../frontend/src/app/app.routes.ts#L13).
- **The reload problem:** after a page reload the access token (memory) is gone, so the guard would say "not logged in". [`src/app/app.config.ts:L34-L37`](../frontend/src/app/app.config.ts#L34-L37) runs `restoreSession()` **before** the first navigation and Angular waits for its Promise. By the time the guard runs, the cookie has been traded for a fresh access token.
- `returnUrl` is only followed if it starts with `/` and not `//` ([`src/app/features/auth/login.ts:L194`](../frontend/src/app/features/auth/login.ts#L194)), otherwise `?returnUrl=//evil.com` would be an **open redirect**.

### Common Mistakes
- Treating guards as security. They're UX: the real protection is the backend returning 401 without a valid token.

---

## 26. RxJS `webSocket()` + Reconnect with Backoff

### Plain English Explanation
`webSocket(url)` turns a WebSocket into an Observable you subscribe to (incoming messages) and also an Observer you `.next()` into (outgoing messages).

### How It Works in Our Code ([`src/app/core/services/websocket-price-feed.ts:L18-L52`](../frontend/src/app/core/services/websocket-price-feed.ts#L18-L52))
- The socket only opens when someone **subscribes** to `events$` (cold). `openObserver` / `closeObserver` drive the `status` signal shown in the header.
- **Reconnect:** `retry({ delay, resetOnSuccess: true })` re-subscribes after an error, which opens a new socket. `resetOnSuccess` restarts the attempt count once messages flow again.
- **Clean close ≠ error.** When the server shuts down politely the stream *completes*, and `retry` would not fire. `concatWith(throwError(...))` ([`src/app/core/services/websocket-price-feed.ts:L46`](../frontend/src/app/core/services/websocket-price-feed.ts#L46)) turns completion into an error so one mechanism handles both.
- **Backoff with jitter** ([`src/app/core/services/websocket-price-feed.ts:L11-L14`](../frontend/src/app/core/services/websocket-price-feed.ts#L11-L14)): 1 s, 2 s, 4 s … 30 s, ±20 %. Without jitter, 10,000 clients dropped by one server restart would all reconnect in the same millisecond (a "thundering herd").
- **Resubscribe on reconnect:** a new socket knows nothing, so `openObserver` re-sends the whole `wanted` set. Tested with a fake WebSocket in `websocket-price-feed.spec.ts`.

### Common Mistakes
- Forgetting the completion case (above).
- Sending messages before the socket is open and assuming they arrive. We only send when `status === 'live'`; everything else is replayed from `wanted` on open.

---

## 27. Batching a Fast Stream (`auditTime`)

### Plain English Explanation
Binance sends ~11 ticks per second (one per crypto symbol) plus 14 simulated stocks every 1.5 s. Re-rendering for each one is wasteful; your eye can't see 25 updates/second anyway.
`auditTime(250)` = "when something arrives, wait 250 ms, then emit the **latest** value". Every tick is still *applied* to state (in `tap`), but the UI gets at most 4 snapshots per second.

### Where Used
[`src/app/core/services/price.service.ts:L62-L68`](../frontend/src/app/core/services/price.service.ts#L62-L68). Measured effect is part of Step 7's numbers (see PROJECT_ARCHITECTURE_GUIDE §9).

### `auditTime` vs `throttleTime` vs `debounceTime`
- `debounceTime`: waits for **silence**. A stream that never pauses would never emit (good for search boxes, wrong here).
- `throttleTime`: emits the **first** value of each window, so the UI could miss the latest price.
- `auditTime`: emits the **last** value of each window. That's what we want for prices.

---

## 28. `httpResource()`: HTTP as a Signal

### Plain English Explanation
Instead of `subscribe` + storing the result in a signal by hand, `httpResource(() => url)` gives you signals directly: `value()`, `isLoading()`, `error()`, `hasValue()`. If the URL function reads signals, it re-fetches when they change.

### Where Used
[`src/app/features/portfolio/portfolio.ts:L81`](../frontend/src/app/features/portfolio/portfolio.ts#L81). It goes through `HttpClient`, so our interceptor attaches the token and does refresh-and-retry automatically. `rows` ([`src/app/features/portfolio/portfolio.ts:L83`](../frontend/src/app/features/portfolio/portfolio.ts#L83)) is a `computed` combining the HTTP result with live prices.

### Common Mistakes
- Reading `value()` while the resource is in an error state throws; check `hasValue()` first (we do).
- Using it for POST/PUT: `httpResource` is for **reading** data; use `HttpClient` for mutations.

---

## 29. CDK Virtual Scrolling

### Plain English Explanation
A theatre with 200 seats but a window that shows only 15: instead of building all 200 seats, build ~20 and **repaint** them as you scroll.

### How It Works
- [`src/app/features/watchlist/watchlist.ts:L148-L152`](../frontend/src/app/features/watchlist/watchlist.ts#L148-L152): `itemSize="56"` tells the CDK every row is exactly 56 px, so it can compute which rows are visible from `scrollTop` alone, without measuring.
- [`src/app/features/watchlist/watchlist.ts:L154`](../frontend/src/app/features/watchlist/watchlist.ts#L154): the virtual version of `@for`; it takes a `trackBy` **function** ([`src/app/features/watchlist/watchlist.ts:L230`](../frontend/src/app/features/watchlist/watchlist.ts#L230)) because it has no `track` syntax.
- The row must really be 56 px: `h-14` with `border-b` inside it (not a `divide-y` gap between rows), and a `block` host element ([`src/app/features/watchlist/components/watchlist-row.ts:L57`](../frontend/src/app/features/watchlist/components/watchlist-row.ts#L57)).
- `?virtual=0` renders every row instead, so you can compare (Step 7).

### Common Mistakes
- Rows with variable height + fixed `itemSize`: the scrollbar and visible rows drift apart.
- No explicit height on the viewport: it collapses to 0 and nothing renders.

---

## 30. `InjectionToken` with a Factory

### Plain English Explanation
For values that aren't classes (a config object, an array), you create a named token. With `providedIn: 'root'` + `factory`, it provides itself; nothing needs to be added to `app.config.ts`.

### Where Used
- [`src/app/core/config/runtime-options.ts:L18`](../frontend/src/app/core/config/runtime-options.ts#L18): reads `?feed=sim`, `?scale=N`, `?virtual=0` once at startup (defaults on the server, where there's no real URL).
- [`src/app/core/data/asset-universe.ts:L63`](../frontend/src/app/core/data/asset-universe.ts#L63): the asset universe, extended with scale-test assets when `?scale=N`. Both the simulated feed and `PriceService` inject it, which avoids a circular dependency between them.

---

## 31. Per-Route Render Mode (`RenderMode.Client`) + Dev Proxy

### Render modes
[`src/app/app.routes.server.ts:L5`](../frontend/src/app/app.routes.server.ts#L5): `/portfolio` and `/login` depend on **who is logged in**, which the build machine can't know, so they're rendered only in the browser. `/watchlist` stays prerendered (a static HTML shell with skeleton rows; prices arrive after hydration).

### Dev proxy
[proxy.conf.json](../frontend/proxy.conf.json) + `angular.json` → `serve.options.proxyConfig`: `npm start` forwards `/api` (and, with `"ws": true`, the WebSocket upgrade) to `localhost:8000`.
In production nginx does the same job ([nginx.conf](../frontend/nginx.conf)). Either way the browser sees **one origin**, which means no CORS configuration, and the `SameSite=Strict` refresh cookie just works.

---

## 32. `afterRenderEffect` + Loading a Third-Party Script (Google button)

### Plain English Explanation
Google's button is drawn by **Google's** JavaScript into a `<div>` we provide. Two timing problems:
1. The `<div>` only exists after Angular has rendered the `@if` (which waits for `/api/auth/config`).
2. Google needs the div's **width**, which only exists after the browser has laid the page out.

`afterRenderEffect(fn)` is an effect that runs **after** Angular has updated the DOM. Like `effect`, it tracks the signals it reads and re-runs when they change.

### Where Used
[login.ts:L156-L169](../frontend/src/app/features/auth/login.ts#L156-L169):
- Reads `googleClientId()` (from `httpResource`) and `googleButton()` (a signal `viewChild`, which becomes defined once the `@if` renders the div).
- `googleButtonHost` remembers which element was already drawn into, so later re-runs don't draw a second button.

Loading the script ([google-identity.service.ts:L41-L58](../frontend/src/app/core/auth/google-identity.service.ts#L41-L58)):
- Creating a `<script>` tag ourselves (instead of putting it in `index.html`) means pages that never show the login form never download Google's code.
- `??=` caches the Promise, so the script loads once even if two callers ask at the same time; on failure the cache is cleared so a retry is possible.
- Google calls our callback **outside** anything Angular started. That's fine in a zoneless app: the callback sets signals (`pending`, `error`) and navigates, and signals schedule change detection themselves.

### Common Mistakes
- Using `ngAfterViewInit` with an element inside `@if`: it may not exist yet. Signal `viewChild` + `afterRenderEffect` handles "appears later".
- Touching `window` / `document` during server rendering. Here it's safe because `/login` is `RenderMode.Client`, and we use `inject(DOCUMENT)` anyway.

