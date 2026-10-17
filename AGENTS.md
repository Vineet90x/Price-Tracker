# AGENTS.md — Instructions for AI coding agents (Claude Code, Antigravity, others)

> Read this whole file before touching anything. These rules override your defaults.

## 1. Who you are working with, and why this project exists

The owner is building this project **to learn**, not just to ship. They want to understand every line
deeply enough to change any part of it without AI help, and later reason about architecture, scaling,
cost, and DevOps. Finishing fast is NOT the goal. Understanding is.

The roadmap lives in `docs/live-price-tracker-build-guide.md` (Phase 1 → 1.5 → 2). Follow it step by step.

### 1.1 What the owner already knows, and what they don't

- **Knows:** JavaScript, HTML, CSS. That's the baseline.
- **Barely knows:** everything else used here: TypeScript, Angular, RxJS, signals, the DOM in depth, npm/Node,
  build tools, SSR/hydration, HTTP details, cookies, JWT, OAuth/Google login, WebSockets, Python, virtual
  environments, FastAPI, SQL/SQLite, Redis, pub-sub, Docker, nginx, DevOps.
- **Never assume** a term is known. The first time a concept appears, explain it from zero (e.g. "what is the
  DOM?", "what is a virtual environment and why does Python need one?", "what is a container?").

### 1.2 The goal: interview-ready, end-to-end understanding

The owner wants to be able to answer **any** interviewer question about this project with confidence, including
scenario questions like *"scale this to a million users: what do you change?"*. They will take their time.
So every explanation (in chat and in docs) must cover, in this order:

1. **What it is**: plain words + an everyday analogy, assuming only JS/HTML/CSS knowledge.
2. **How it actually works** underneath (the real mechanism, step by step).
3. **A concrete example**: ideally from this project's code (file:line), otherwise a tiny standalone one.
4. **Why we chose it** over the alternatives, and what we gave up.
5. **How it helps** this project (what breaks or gets worse without it).
6. **At large scale** (10k → 1M users): what stops working first, what you'd change, rough cost implications.
7. **Interview angle**: likely questions and how to answer them.

## 2. The teaching workflow — MANDATORY

1. **Explain before you change.** Before editing even one line of code, tell the owner:
   - which file and which lines will change,
   - the exact code to be added/removed (show it),
   - *why*: what problem it solves, what it achieves,
   - alternatives considered and why this one wins (or what trade-off we accept),
   - any bottleneck / scaling / cost implication, including "this is fine now but would not scale because X".
2. **Wait for explicit approval** ("ok", "go ahead", "next") before applying the change.
3. **One change (or one tightly related group) at a time.** Never batch unrelated changes.
4. After applying, explain what to look for to verify it worked (browser, console, test, build output).
5. Don't make an architectural decision on the owner's behalf. Present the options with a recommendation and let them choose.
   Record the decision in the Decision Log (see §4).
6. If you spot a bug or a smell while doing something else, **mention it, don't silently fix it**.
7. Questions from the owner come first. If they ask "why", answer in depth with references to their actual code.

## 3. Documentation you must maintain (update after every approved change)

| File | Purpose | What to add |
|---|---|---|
| `docs/PROJECT_ARCHITECTURE_GUIDE.md` | Project understanding: where we started, what we built, the flow, *why* each structural decision | Step log, data flow, file + line references, Decision Log entries, Tech-Debt Backlog updates |
| `docs/ANGULAR_FRAMEWORK_GUIDE.md` | Framework understanding: each Angular / RxJS / TS concept we used | Simple explanation → how Angular does it internally → where it's used in OUR code (file:line) → common mistakes |
| `docs/LEARNING_PATH.md` + `docs/learning/module-0…7-*.md` | From-zero curriculum for the whole stack (web basics → tooling → Angular → backend → security → real-time → infra → scale) + interview question bank | Lessons live in `docs/learning/` in the §1.2 format. Mark a topic ✅ only when the owner can answer its questions. When code changes, update the lessons that link to it |

Rules for docs:
- Use **relative** links like `[watchlist.ts:L171](frontend/src/app/features/watchlist/watchlist.ts#L171)`. Never absolute machine paths.
- Line numbers must match the current code. If you change a file, fix any references to it that shifted.
  Run `python tools/check_doc_links.py` afterwards (catches missing files / out-of-range lines; it can't
  tell whether a range still points at the *right* code, so re-read the links into files you changed).
- Write simply. Analogy first, then the real mechanism.
- Be honest about weaknesses. A "Known limitations" note is better than pretending.

## 4. Decision Log format (in PROJECT_ARCHITECTURE_GUIDE.md)

```
Step:
Decision:
Options considered:
Why I chose it:
What I'd reconsider at larger scale:
```

## 5. Tech stack facts (verify before assuming)

- **Angular 22**, standalone components only (no NgModules), **zoneless** (no `zone.js` in package.json).
  Change detection is driven by signals, template events, and the `async` pipe, NOT by Zone.js patching timers.
- **SSR + prerender** is configured (`frontend/angular.json` → `outputMode: "server"`, `frontend/src/app/app.routes.server.ts` → `RenderMode.Prerender`).
  Production Docker image currently serves only `dist/price-tracker/browser` through nginx (`frontend/Dockerfile`), so `frontend/src/server.ts` does not run in prod.
  Browser-only APIs (`window`, `document`, canvas, `ResizeObserver`) must be guarded with `isPlatformBrowser` or `afterNextRender`.
- **State**: Angular signals (`signal`, `computed`, `toSignal`) + RxJS for streams over time.
- **Styling**: Tailwind CSS v4 via PostCSS (`frontend/.postcssrc.json`, `frontend/src/styles.css`). PrimeNG 22 (Aura theme) is installed for UI widgets.
- **Charts**: `lightweight-charts` v5 (TradingView).
- **Tests**: Vitest via `@angular/build:unit-test`.
- **Virtual scrolling**: `@angular/cdk/scrolling` (watchlist list; rows must stay exactly 56 px).
- **HTTP/auth**: `provideHttpClient(withFetch(), withInterceptors([authInterceptor]))`; access token in memory,
  refresh token in an httpOnly cookie. `/api` is same-origin (dev proxy `frontend/proxy.conf.json`, prod nginx `frontend/nginx.conf`).
- **Prices**: `PriceService` depends only on the abstract `PriceFeed` (WebSocket / Simulated / Noop), chosen in
  `frontend/src/app/core/services/price-feed.provider.ts`. URL switches: `?feed=sim`, `?scale=N`, `?virtual=0`.
- **Backend** (`backend/`): FastAPI + SQLAlchemy (SQLite) + Redis pub-sub, Binance combined stream for crypto,
  server-side simulation for NSE stocks. Runs in Docker (Python 3.12); see PROJECT_ARCHITECTURE_GUIDE §10–§13.
- **TypeScript** strict mode, `strictTemplates` on.

## 6. Code conventions

- Folder layout (all under `frontend/`): `src/app/core/` = app-wide singletons (services, models, later guards/interceptors);
  `src/app/features/<feature>/` = one folder per page, sub-components in `features/<feature>/components/`;
  `src/app/shared/` = reusable dumb UI pieces, pipes, directives (create when first needed).
- Components: standalone, `ChangeDetectionStrategy.OnPush`, `inject()` instead of constructor injection.
- Prefer signal APIs (`input()`, `output()`, `viewChild()`) for new code. Existing decorator code (`@Input`, `@ViewChild`) is only migrated with the owner's approval.
- Templates should stay **pure**: no methods with side effects called from templates; prefer `computed()` signals.
- Use built-in control flow (`@if`, `@for` with `track`, `@switch`), not `*ngIf`/`*ngFor`.
- No `any` without a comment explaining why.
- Services own state; components read it. Writable signals stay `private`; expose read-only signals/computed.
- Formatting: Prettier (`.prettierrc`): single quotes, 100-column width.

## 7. Commands

Repo layout: `frontend/` (Angular), `backend/` (FastAPI), `docs/` (guides + learning path), `tools/`,
and `docker-compose.yml` at the root.

```bash
# frontend (run inside frontend/)
cd frontend
npm ci                         # install exact locked deps
npm start                      # dev server → http://localhost:4200 (proxies /api to :8000)
npx ng build                   # production build (watch the bundle budget warnings)
npx ng test --watch=false      # unit tests (Vitest)

# whole stack (run at the repo root). Settings/secrets: .env (git-ignored), template .env.example
cp .env.example .env          # first time only, then fill in JWT_SECRET etc.
docker compose up --build -d   # full stack: nginx :4200 → FastAPI :8000 → Redis :6379
docker compose logs -f backend # backend logs (Binance connection, feed restarts)
curl localhost:4200/api/health # fan-out counters (binance_connections should stay 1)
py -3.12 tools/check_doc_links.py  # verify every doc link after code changes
```

## 8. Current progress (update this when a step completes)

- Phase 1 Steps 1–6: code exists (built earlier, with AI help). Currently being **revised step by step**
  so the owner understands it. Revision progress is tracked in `docs/PROJECT_ARCHITECTURE_GUIDE.md`.
- UI redesign R1–R7 ("trading terminal" look): done (2026-10-17).
- Phase 1 Step 7 (scale test, virtual scroll): done with measurements (2026-10-17).
- Phase 1.5 (FastAPI auth) and Phase 2 (WebSocket + Binance + Redis fan-out): built and verified (2026-10-17),
  at the owner's request in one go. The owner has NOT yet revised these step by step; walk through them
  with the same teaching workflow before changing them further.
- Known issues are tracked in the "Tech-Debt Backlog" section of `docs/PROJECT_ARCHITECTURE_GUIDE.md`.

## 9. Never

- Never commit, push, or install/remove dependencies without asking first.
- Never rewrite large parts of a file in one go. Small, explained diffs.
- Never delete the owner's docs content. Restructure it only with approval.
- Never claim something works without running the build/tests or saying you didn't.
