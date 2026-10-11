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



---

## 1. Standalone Components (`standalone: true`)

### Plain English Explanation
Think of a Standalone Component as a **self-contained tool kit**. Before Angular 14+, components had to belong to a "toolbox" called an `NgModule`. If Component A wanted to use Component B, both had to be registered in the same `NgModule`. 

With **Standalone Components**, a component manages its own dependencies. If it needs a button or an input directive, it lists it directly in its `@Component({ imports: [...] })` array.

### How Angular Handles It Behind the Scenes
Angular's compiler inspects the `imports` array of the standalone component and links only those specific dependencies at compile time. This enables precise code splitting and tree-shaking, meaning unused Angular modules are automatically stripped out of the production JavaScript bundle.

### Where Used in Our Codebase:
- [`src/app/features/watchlist/watchlist.ts:L7`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L7)
- [`src/app/features/portfolio/portfolio.ts:L5`](file:///home/alpha/Documents/Price-Tracker/src/app/features/portfolio/portfolio.ts#L5)
- [`src/app/app.ts:L6`](file:///home/alpha/Documents/Price-Tracker/src/app/app.ts#L6)

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
- [`src/app/features/watchlist/watchlist.ts:L106`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L106)
- [`src/app/features/portfolio/portfolio.ts:L17`](file:///home/alpha/Documents/Price-Tracker/src/app/features/portfolio/portfolio.ts#L17)
- [`src/app/app.ts:L10`](file:///home/alpha/Documents/Price-Tracker/src/app/app.ts#L10)

---

## 3. Routing & Lazy Loading (`provideRouter`, `loadComponent`)

### Plain English Explanation
Imagine ordering a 5-course dinner at a restaurant. Instead of bringing all 5 courses to your table at once (which makes the table crowded and your food cold), the kitchen brings each course only when you're ready to eat it.

That is **Lazy Loading**. The browser downloads the core shell first (`main.js`). When you click on `/portfolio`, it dynamically downloads `chunk-portfolio.js` just in time.

### How Angular Handles It Behind the Scenes
`loadComponent: () => import('./path').then(m => m.Component)` uses standard JavaScript dynamic imports. Build tools (esbuild/webpack) split dynamic imports into separate `.js` chunk files during build time.

### Where Used in Our Codebase:
- [`src/app/app.routes.ts:L5-L12`](file:///home/alpha/Documents/Price-Tracker/src/app/app.routes.ts#L5-L12)

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
- Import declaration: [`src/app/app.ts:L7`](file:///home/alpha/Documents/Price-Tracker/src/app/app.ts#L7)
- HTML usage: [`src/app/app.html:L20-L38`](file:///home/alpha/Documents/Price-Tracker/src/app/app.html#L20-L38) & [`src/app/app.html:L50`](file:///home/alpha/Documents/Price-Tracker/src/app/app.html#L50)

---

## 5. Singleton Services (`@Injectable({ providedIn: 'root' })`)

### Plain English Explanation
Imagine a building with a single water tank on the roof that supplies water to every apartment. No matter which apartment turns on a tap, they are receiving water from the **exact same central supply**.

`@Injectable({ providedIn: 'root' })` tells Angular to create **one single instance** of the service across the entire application lifetime. Whether 5 different components request `PriceService`, Angular gives them all the exact same object instance.

### Where Used in Our Codebase:
- [`src/app/core/services/price.service.ts:L12`](file:///home/alpha/Documents/Price-Tracker/src/app/core/services/price.service.ts#L12)

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
- [`src/app/core/services/price.service.ts:L55-L58`](file:///home/alpha/Documents/Price-Tracker/src/app/core/services/price.service.ts#L55-L58)

```typescript
this.prices$ = interval(1500).pipe(
  map(() => this.calculateNextPrices())
);
```

---

## 7. RxJS Multicasting (`shareReplay(1)`)

### Plain English Explanation
Imagine a TV live broadcast of a football match. If 1,000 people turn on their TVs to watch the match, the stadium does **not** play 1,000 separate games! Instead, **one single match** is played, and the signal is broadcasted (multicasted) to all viewers.

Without `shareReplay(1)`, every time a new component subscribes to `prices$`, Angular would start a brand new `interval(1500)` timer and run a separate random-walk calculation! 

With `shareReplay(1)`:
1. Only **one central timer** runs.
2. The `(1)` parameter remembers the **latest calculated price array**, so any component that joins late instantly receives the current market prices without waiting for the next tick.

### Where Used in Our Codebase:
- [`src/app/core/services/price.service.ts:L57`](file:///home/alpha/Documents/Price-Tracker/src/app/core/services/price.service.ts#L57)

---

## 8. Angular Signals (`toSignal()`, `computed()`)

### Plain English Explanation
Imagine a spreadsheet cell (A1) with number `10`, and cell B1 with formula `=A1 * 2`. Whenever you change A1 to `20`, cell B1 updates to `40` automatically. 

That is **Signals**:
- `toSignal(stream$)`: Converts a continuous RxJS Observable stream into a Signal getter function `pricesSignal()`.
- `computed(() => ...)`: Creates a derived signal cell (like `gainersCount()`) that recalculates automatically whenever `pricesSignal()` updates.

### Where Used in Our Codebase:
- Stream conversion: [`src/app/core/services/price.service.ts:L61`](file:///home/alpha/Documents/Price-Tracker/src/app/core/services/price.service.ts#L61)
- Derived state: [`src/app/core/services/price.service.ts:L63-L71`](file:///home/alpha/Documents/Price-Tracker/src/app/core/services/price.service.ts#L63-L71)

---

## 9. Modern Template Control Flow (`@for (...; track ...)`)

### Plain English Explanation
In older Angular versions, rendering lists required `*ngFor="let item of items; trackBy: trackFn"`. 

In Angular 17+, built-in control flow syntax `@for (item of items; track item.id)` is built directly into the template compiler. 
- The mandatory `track` expression acts like a **label tag** on each row. When item #2 updates, Angular changes only row #2 in the DOM instead of re-rendering the entire list!

### Where Used in Our Codebase:
- [`src/app/features/watchlist/watchlist.ts:L31`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L31)

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
- [`src/app/features/watchlist/watchlist.ts:L109`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L109)

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
- [`src/app/features/watchlist/watchlist.ts:L54-L71`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L54-L71)

---

## 12. PrimeNG UI Integration & Skeletons (`providePrimeNG`, `<p-skeleton>`)

### Plain English Explanation
Think of **PrimeNG** as a pre-fabricated blueprint library for high-end UI widgets (Buttons, Modals, Skeleton Loaders, Tables, Charts). 

Instead of manually styling placeholder loader boxes using custom CSS, PrimeNG provides `<p-skeleton>`:
- Provides built-in shimmer wave animations.
- Fully accessible and responsive.
- Configured globally via `providePrimeNG({ theme: { preset: Aura } })` in `app.config.ts`.

### Where Used in Our Codebase:
- Global configuration: [`src/app/app.config.ts:L15-L21`](file:///home/alpha/Documents/Price-Tracker/src/app/app.config.ts#L15-L21)
- Component import: [`src/app/features/watchlist/watchlist.ts:L3`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L3)
- Template usage: [`src/app/features/watchlist/watchlist.ts:121-125`](file:///home/alpha/Documents/Price-Tracker/src/app/features/watchlist/watchlist.ts#L121-L125)


