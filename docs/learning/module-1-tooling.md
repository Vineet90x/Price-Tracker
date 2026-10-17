# Module 1: Tooling Around JavaScript

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 0](module-0-web-basics.md) · Next: [Module 2: Angular](module-2-angular.md)

You know JavaScript that runs in a browser. This module covers the **machinery around it**: the tools that
turn our source code into the files a browser downloads, check our code before it runs, and test it.

---

## 1.1 Node.js, npm, `package.json`, `package-lock.json`, `node_modules`

**What it is.**
- **Node.js** is JavaScript running *outside* the browser, on your computer or a server. Same language, but
  instead of `document` and `window` it can read files, start servers and run programs.
- **npm** is Node's package manager: an app store for code libraries.
- **`package.json`** is the shopping list: which libraries the project needs.
- **`package-lock.json`** is the exact receipt: precisely which version of every library (and every library
  *those* need) was installed last time.
- **`node_modules/`** is the pantry where everything on the receipt is unpacked.

**How it works.**
- Our app runs in the **browser**, so why do we need Node? Because all the **tools** are Node programs: the
  Angular CLI (`ng`), the compiler, the bundler, the dev server, the test runner. In production the browser
  only receives the finished output files; no Node is involved (nginx serves them).
- `npm start` (run inside `frontend/`, where package.json lives) runs the script named `start` in package.json: [package.json:L6](../../frontend/package.json#L6).
- **dependencies** (code that ends up in the app: Angular, RxJS, lightweight-charts) [package.json:L14](../../frontend/package.json#L14)
  vs **devDependencies** (tools only needed to build/test: TypeScript, Tailwind, Vitest) [package.json:L32](../../frontend/package.json#L32).
- **Version ranges** (semantic versioning, `MAJOR.MINOR.PATCH`):
  - `^22.2.2` = any `22.x.y` ≥ 22.2.2 (minor and patch updates allowed; 23 is not).
  - `~7.8.0` = any `7.8.y` (patch updates only), e.g. RxJS [package.json:L29](../../frontend/package.json#L29).
  - A MAJOR bump means "breaking changes possible".
- **`npm install`** reads package.json, picks versions within the ranges and *updates* the lock file.
  **`npm ci`** ("clean install") installs **exactly** what the lock file says and **fails** if package.json and
  the lock file disagree. That makes builds reproducible: your laptop, a teammate and the Docker build all get the same code.

**Example from our code.** The Docker build runs `npm ci … || npm install …` [Dockerfile:L8](../../frontend/Dockerfile#L8). The
`|| npm install` means "if the exact install fails, quietly install something else". That hides exactly the
problem `npm ci` is meant to catch (Backlog #15).

**Why we chose it.** For an Angular project there's no real alternative to Node-based tooling. Between npm, yarn and pnpm:
npm comes with Node, and the project pins it (`"packageManager": "npm@11.6.2"`).

**How it helps.** One command (`npm ci`) recreates the exact environment on any machine, which is the foundation
for "it works on my machine *and* in Docker *and* in CI".

**At large scale.**
- **Supply-chain risk:** `node_modules` holds hundreds of packages written by strangers. Teams run `npm audit`,
  use automated update bots (Dependabot/Renovate), and sometimes a private registry mirror.
- **CI speed:** cache `~/.npm` between builds; `npm ci` on a warm cache takes seconds instead of minutes.

**Interview angle.**
- *"dependencies vs devDependencies?"* Runtime code vs build/test tools.
- *"What's the lock file for? `npm ci` vs `npm install`?"* Exact reproducibility; `ci` never changes the lock file and fails on drift.
- *"`^` vs `~`?"* Minor+patch updates vs patch only.

---

## 1.2 TypeScript

**What it is.** JavaScript **plus type labels**. You write `price: number`, and a checker tells you *before the
code runs* if you ever try to put a string there. Like spell-check for data shapes.

**How it works.**
- The TypeScript compiler checks the types, then **erases** them, producing plain JavaScript. Browsers never
  see TypeScript, so **types don't exist at runtime**. That's why an `interface` can't be an Angular DI token
  but an abstract class can (ANGULAR_FRAMEWORK_GUIDE §23).
- **Interfaces** describe object shapes: [price-feed.ts:L5-L10](../../frontend/src/app/core/services/price-feed.ts#L5-L10).
- **Union types** list allowed values: [price-feed.ts:L21](../../frontend/src/app/core/services/price-feed.ts#L21) means the
  status can *only* be one of those four strings.
- **Generics** are type parameters: `signal<FeedStatus>('connecting')` means "a signal that only ever holds a FeedStatus".
- **Strict mode** [tsconfig.json:L6](../../frontend/tsconfig.json#L6) turns on the useful checks (e.g. "this could be `null`, handle it").
  Angular's `strictTemplates` [tsconfig.json:L22](../../frontend/tsconfig.json#L22) type-checks the HTML templates too.

**Example from our code.** `FEED_LABELS` is typed `Record<FeedStatus, string>` [app.ts:L9-L14](../../frontend/src/app/app.ts#L9-L14).
If someone adds a fifth status (say `'stale'`) to `FeedStatus` and forgets the header label, the build **fails**
instead of the header showing `undefined` in production. Another one: `p.time as UTCTimestamp`
[stock-chart.ts:L32-L34](../../frontend/src/app/features/watchlist/components/stock-chart.ts#L32-L34) tells the chart library
"this number is a timestamp in seconds", a mistake (milliseconds!) the old `as any` would have hidden.

**Why we chose it.** Angular is built on TypeScript. With strict mode, whole classes of bugs (typos in property
names, forgetting `null`, wrong argument types) show up while typing in the editor instead of in front of users.

**How it helps.** Refactoring safely: when we changed `PriceService` for Phase 2, the compiler listed every
place that no longer fitted.

**At large scale.** Types become **contracts between teams**: e.g. generate TypeScript types from the backend's
OpenAPI schema so frontend and backend can't drift apart (today `TokenResponse` in auth.service.ts is written
by hand to match the Python model).

**Interview angle.**
- *"Do types exist at runtime?"* No. Validate data from the network at runtime anyway: the backend does with Pydantic.
- *"`interface` vs `type`?"* Mostly interchangeable. Interfaces can be extended/merged; `type` can express unions.
- *"What does `as` do?"* Overrides the checker ("trust me"). Use sparingly; `as any` switches checking off completely.

---

## 1.3 Bundlers, builds, code splitting, bundle budgets

**What it is.** Our source is ~100 files of TypeScript, HTML and CSS plus thousands of files in `node_modules`.
A **bundler** turns that into a few optimised `.js`/`.css` files a browser can download quickly. Like packing a
house into a few labelled moving boxes.

**How it works.** `ng build` (Angular's `application` builder, using **esbuild**) does:
1. **Compile** TypeScript → JavaScript, and Angular templates → JavaScript instructions.
2. **Bundle**: follow every `import` and combine what's used.
3. **Tree-shake**: drop code that's imported nowhere.
4. **Minify**: rename variables to short names and strip whitespace and comments.
5. **Code-split**: every `import()` inside `loadComponent` [app.routes.ts:L8](../../frontend/src/app/app.routes.ts#L8)
   becomes a separate *lazy chunk* (watchlist, portfolio, login), downloaded only when that page is visited.
6. **Hash file names** (`main-K3NLUO42.js`) [angular.json:L54](../../frontend/angular.json#L54): the name changes whenever the
   content changes, so nginx can tell browsers to cache files for a year [nginx.conf:L38](../../frontend/nginx.conf#L38) ("cache busting").

`npm start` uses **Vite** instead: it doesn't produce a production bundle; it serves files on demand and
hot-reloads the page when you save.

**Example from our code.** The production build reports an **initial bundle of ~576 kB** (raw; ~141 kB after
gzip compression over the network), above the **500 kB budget** we set [angular.json:L44-L47](../../frontend/angular.json#L44-L47).
"Initial" = everything needed before the first page appears. The biggest suspects are PrimeNG + its theme, used
only for skeleton placeholders (Backlog #13).

**Why we chose it.** The Angular CLI's builder is the default and needs no configuration. Lazy routes keep the
login page's code out of the watchlist's first load.

**How it helps.** Less JavaScript means faster first load, especially on phones, where *parsing and running* JS
costs as much as downloading it.

**At large scale.**
- **Measure** with `ng build --stats-json` + a bundle analyser; remove or lazy-load heavy libraries.
- **CDN + long-lived caching** of hashed files; only `index.html` must never be cached for long.
- **Performance budgets in CI** turn "the app got slower" into a failed build.

**Interview angle.**
- *"What is tree shaking?"* Removing exports nobody imports; it needs ES module `import/export` syntax.
- *"How does lazy loading work?"* `import()` returns a Promise; the bundler makes it a separate file, fetched on first navigation.
- *"Why hash file names?"* So you can cache aggressively and still ship updates instantly.

---

## 1.4 Tailwind CSS and PostCSS

**What it is.** Instead of writing CSS rules in a separate file, you compose small ready-made classes directly in
HTML: `class="h-10 px-3 text-xs text-ink-muted"`. **PostCSS** is the pipeline that transforms CSS during the
build; Tailwind is one plugin in it.

**How it works.**
1. The build runs PostCSS on `styles.css` (configured in [.postcssrc.json:L3](../../frontend/.postcssrc.json#L3)).
2. `@import 'tailwindcss'` [styles.css:L1](../../frontend/src/styles.css#L1) pulls in Tailwind.
3. Tailwind **scans all project files** for class-like words and generates CSS **only for the classes it
   finds**. That's why you must write full class names in source, never build them like `'text-' + color`.
4. Our own design tokens live in `@theme static` [styles.css:L10](../../frontend/src/styles.css#L10) and become classes such as
   `bg-surface-1` or `text-up`, plus CSS variables the chart reads (ANGULAR_FRAMEWORK_GUIDE §15).

**Example from our code.** `text-up` / `text-down` are used everywhere a price moves. Changing `--color-up` in one
place recolours rows, badges, the chart and toasts.

**Why we chose it.** You already knew Tailwind; it's fast to iterate with, and unused CSS is never shipped (our
whole stylesheet is ~27 kB).

**How it helps.** No naming debates, no dead CSS piling up, and a consistent spacing/colour system.

**At large scale.** Long class lists get repetitive, so you extract **components** (we did: `watchlist-row`,
`alert-panel`). A shared token file becomes the company **design system**.

**Interview angle.**
- *"Doesn't Tailwind bloat the HTML?"* A little, but the CSS stays tiny and gzip compresses repeated class names extremely well.
- *"Why can't I build class names dynamically?"* The scanner only sees literal strings in the source.

---

## 1.5 Unit tests (Vitest)

**What it is.** Small programs that run your code with known inputs and check the outputs automatically, like a
checklist a robot runs every time you change something.

**How it works.**
- Test files end in `.spec.ts`. `describe` groups tests, `it` is one test, `expect(x).toBe(y)` is an assertion.
- `npx ng test --watch=false` runs them with **Vitest** [angular.json:L80](../../frontend/angular.json#L80) inside
  **jsdom** [package.json:L39](../../frontend/package.json#L39), a fake browser (a DOM implemented in Node), so no real browser is needed.
- **Fakes/mocks** replace the slow or unpredictable outside world with something the test controls.

**Example from our code (15 tests).**
- [price.service.spec.ts:L8-L16](../../frontend/src/app/core/services/price.service.spec.ts#L8-L16): a fake price feed the test pushes ticks
  into by hand, to check things like "an out-of-order tick is ignored".
- [auth.interceptor.spec.ts:L66](../../frontend/src/app/core/auth/auth.interceptor.spec.ts#L66): Angular's
  `HttpTestingController` plays the server, proving two simultaneous 401s cause only **one** refresh.
- [websocket-price-feed.spec.ts:L6](../../frontend/src/app/core/services/websocket-price-feed.spec.ts#L6): a fake WebSocket that lets the test
  "restart the server" and check the app reconnects and re-subscribes.

**Why we chose it.** Vitest is what Angular 22's test builder uses: fast, with a Jest-like API. We tested the parts
that are **hardest to check by clicking around**: race conditions, reconnection, ordering.

**How it helps.** Refactoring with confidence; these tests also fixed Backlog #8 (the old tests were broken).

**At large scale.**
- **Testing pyramid:** many fast unit tests, fewer integration tests (real backend + database), a handful of
  end-to-end browser tests (e.g. Playwright) for the critical flows (login, live price, alert).
- **CI** runs everything on every pull request; nothing merges with red tests.
- **Load tests** (k6, Locust) for the backend: thousands of fake WebSocket clients to find the breaking point *before* users do.

**Interview angle.**
- *"Unit vs integration vs e2e?"* One piece in isolation / several real pieces together / the whole app through a real browser.
- *"What do you mock?"* Things outside your control or slow: network, time, WebSockets. Don't mock the code you're testing.
- *"How did you test reconnection?"* With a fake WebSocket: close it, wait for the backoff, assert a new socket re-subscribes.
