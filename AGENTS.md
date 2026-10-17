# AGENTS.md — Instructions for AI coding agents (Claude Code, Antigravity, others)

> Read this whole file before touching anything. These rules override your defaults.

## 1. Who you are working with, and why this project exists

The owner is building this project **to learn**, not just to ship. They want to understand every line
deeply enough to change any part of it without AI help, and later reason about architecture, scaling,
cost, and DevOps. Finishing fast is NOT the goal. Understanding is.

The roadmap lives in `live-price-tracker-build-guide.md` (Phase 1 → 1.5 → 2). Follow it step by step.

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
| `PROJECT_ARCHITECTURE_GUIDE.md` | Project understanding: where we started, what we built, the flow, *why* each structural decision | Step log, data flow, file + line references, Decision Log entries, Tech-Debt Backlog updates |
| `ANGULAR_FRAMEWORK_GUIDE.md` | Framework understanding: each Angular / RxJS / TS concept we used | Simple explanation → how Angular does it internally → where it's used in OUR code (file:line) → common mistakes |

Rules for docs:
- Use **relative** links like `[watchlist.ts:L171](src/app/features/watchlist/watchlist.ts#L171)`. Never absolute machine paths.
- Line numbers must match the current code. If you change a file, fix any references to it that shifted.
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
- **SSR + prerender** is configured (`angular.json` → `outputMode: "server"`, `src/app/app.routes.server.ts` → `RenderMode.Prerender`).
  Production Docker image currently serves only `dist/price-tracker/browser` through nginx (`Dockerfile`), so `src/server.ts` does not run in prod.
  Browser-only APIs (`window`, `document`, canvas, `ResizeObserver`) must be guarded with `isPlatformBrowser` or `afterNextRender`.
- **State**: Angular signals (`signal`, `computed`, `toSignal`) + RxJS for streams over time.
- **Styling**: Tailwind CSS v4 via PostCSS (`.postcssrc.json`, `src/styles.css`). PrimeNG 22 (Aura theme) is installed for UI widgets.
- **Charts**: `lightweight-charts` v5 (TradingView).
- **Tests**: Vitest via `@angular/build:unit-test`.
- **TypeScript** strict mode, `strictTemplates` on.

## 6. Code conventions

- Folder layout: `src/app/core/` = app-wide singletons (services, models, later guards/interceptors);
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

```bash
npm ci                         # install exact locked deps
npm start                      # dev server → http://localhost:4200
npx ng build                   # production build (watch the bundle budget warnings)
npx ng test --watch=false      # unit tests (Vitest)
docker compose up --build -d   # production image via nginx → http://localhost:4200
```

## 8. Current progress (update this when a step completes)

- Phase 1 Steps 1–6: code exists (built earlier, with AI help). Currently being **revised step by step**
  so the owner understands it. Revision progress is tracked in `PROJECT_ARCHITECTURE_GUIDE.md`.
- Phase 1 Step 7 (scale test, virtual scroll): not started.
- Phase 1.5 (FastAPI auth) and Phase 2 (WebSocket + Redis): not started.
- Known issues are tracked in the "Tech-Debt Backlog" section of `PROJECT_ARCHITECTURE_GUIDE.md`.

## 9. Never

- Never commit, push, or install/remove dependencies without asking first.
- Never rewrite large parts of a file in one go. Small, explained diffs.
- Never delete the owner's docs content. Restructure it only with approval.
- Never claim something works without running the build/tests or saying you didn't.
