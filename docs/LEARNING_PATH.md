# Learning Path: Understand This Project End to End

> **Who this is for:** someone who knows JavaScript, HTML and CSS, and not much else yet.
> **Goal:** understand every technology in this project well enough to explain it, change it without help,
> and answer any interview question about it, including "how would you scale this to a million users?".
> **Pace:** one topic at a time. A topic is done when you can answer its questions out loud without notes.

How every topic is written (see AGENTS.md §1.2):
**What it is** (analogy) → **How it works** (mechanism) → **Example** (our code) → **Why we chose it** →
**How it helps** → **At large scale** → **Interview angle**.

Status: ⬜ not started · 📖 lesson written (read it, then try the questions) · ✅ you can answer every question without notes

---

## Module 0: How the web works (foundation for everything else)

📖 **Lessons: [learning/module-0-web-basics.md](learning/module-0-web-basics.md)**

| # | Topic | You should be able to answer | Where it shows up in this project | Status |
|---|---|---|---|---|
| 0.1 | Browser → server: URLs, DNS, HTTP request/response, status codes | What happens when you type `localhost:4200/watchlist` and press Enter? What does 401 vs 403 vs 404 mean? | Every page load; `/api/*` calls; 401 → refresh flow | 📖 |
| 0.2 | **The DOM** | What is the DOM, and why is updating it "expensive"? | Everything Angular renders; Step 7 measurements | 📖 |
| 0.3 | How the browser renders: style → layout → paint | Why did 205 rows cost 7× more style recalculation than 24? | [Step 7 results](PROJECT_ARCHITECTURE_GUIDE.md#9-phase-1-step-7-scale-test--virtual-scrolling-) | 📖 |
| 0.4 | The JavaScript event loop, async, Promises | Why doesn't a WebSocket message freeze the page? What is a "task"? | Ticks, timers, `await` in `restoreSession` | 📖 |
| 0.5 | Cookies, same-origin, CORS, SameSite | Why can't JavaScript read our refresh cookie? Why didn't we need CORS? | [auth.py `_set_refresh_cookie`](../backend/app/routers/auth.py), [nginx.conf](../frontend/nginx.conf) | 📖 |
| 0.6 | JSON, REST APIs | What is a REST endpoint? Why JSON? | `/api/auth/*`, `/api/portfolio` | 📖 |

## Module 1: Tooling around JavaScript

📖 **Lessons: [learning/module-1-tooling.md](learning/module-1-tooling.md)**

| # | Topic | You should be able to answer | Where | Status |
|---|---|---|---|---|
| 1.1 | Node.js, npm, `package.json`, `package-lock.json`, `node_modules` | Why does a frontend project need Node? What does `npm ci` do differently from `npm install`? | [package.json](../frontend/package.json) | 📖 |
| 1.2 | TypeScript | What does TS add to JS, and why does it disappear at runtime? What is `strict` mode? | every `.ts` file; [tsconfig.json](../frontend/tsconfig.json) | 📖 |
| 1.3 | Bundlers & builds (esbuild/Vite via Angular CLI), code splitting, bundle budgets | What is a "chunk"? Why is our initial bundle 576 kB, and why does that matter on a phone? | `npx ng build` output; Backlog #13 | 📖 |
| 1.4 | Tailwind CSS & PostCSS | How do classes like `bg-surface-1` become CSS? | [styles.css](../frontend/src/styles.css); ANGULAR_FRAMEWORK_GUIDE §15 | 📖 |
| 1.5 | Unit tests (Vitest) | What does a test prove? What's a fake/mock and why did we write `FakeFeed`? | `*.spec.ts` | 📖 |

## Module 2: Angular (the frontend framework)

📖 **Lessons: [learning/module-2-angular.md](learning/module-2-angular.md)**

The module file explains each topic from zero; [ANGULAR_FRAMEWORK_GUIDE.md](ANGULAR_FRAMEWORK_GUIDE.md) has the deeper per-concept notes (§ numbers). Learn in this order:

| # | Topic | Framework guide § | Status |
|---|---|---|---|
| 2.1 | Components, templates, standalone | §1, §9, §11, §19 | 📖 |
| 2.2 | Dependency injection & services | §5, §10, §23, §30 | 📖 |
| 2.3 | Change detection, OnPush, zoneless | §2 | 📖 |
| 2.4 | Signals: `signal`, `computed`, `effect` | §8, §17, §20, §32 | 📖 |
| 2.5 | RxJS: Observables and operators | §6, §7, §26, §27 + Step 5 operators | 📖 |
| 2.6 | Routing, guards, lazy loading | §3, §4, §25 | 📖 |
| 2.7 | Forms (reactive, typed, validators) | Step 5 forms, §18 | 📖 |
| 2.8 | HTTP, interceptors, `httpResource` | §24, §28 | 📖 |
| 2.9 | SSR, prerender, hydration | §14, §31 | 📖 |
| 2.10 | Performance: virtual scrolling, batching | §21, §27, §29 | 📖 |

## Module 3: Backend

📖 **Lessons: [learning/module-3-backend.md](learning/module-3-backend.md)**

| # | Topic | You should be able to answer | Where | Status |
|---|---|---|---|---|
| 3.1 | Python basics for JS developers | How do Python modules/imports, `async def`, decorators map to JS ideas? | `backend/app/` | 📖 |
| 3.2 | **Virtual environments** & `requirements.txt` | Why does Python need a venv when Node has `node_modules`? What does pinning versions protect against? | [requirements.txt](../backend/requirements.txt), Docker image | 📖 |
| 3.3 | FastAPI: routes, dependencies (`Depends`), Pydantic validation | What happens between an HTTP request arriving and `login()` running? | [routers/auth.py](../backend/app/routers/auth.py), [deps.py](../backend/app/deps.py) | 📖 |
| 3.4 | ASGI, uvicorn, async I/O | How does one Python process hold thousands of WebSockets? | [main.py](../backend/app/main.py) | 📖 |
| 3.5 | SQL, SQLite, SQLAlchemy ORM, migrations | Why did adding Google login need a migration? What would Postgres change? | [models.py](../backend/app/models.py), [db.py `migrate()`](../backend/app/db.py) | 📖 |

## Module 4: Security & authentication

📖 **Lessons: [learning/module-4-security.md](learning/module-4-security.md)**

| # | Topic | You should be able to answer | Where | Status |
|---|---|---|---|---|
| 4.1 | Password hashing (Argon2), salts, timing attacks | Why not store passwords encrypted? Why hash a dummy password for unknown emails? | [security.py](../backend/app/security.py) | 📖 |
| 4.2 | JWT: structure, signing (HS256 vs RS256), expiry | Can a user edit their own JWT? Why are access tokens short-lived? | `create_access_token`, `verify_google_id_token` | 📖 |
| 4.3 | Access + refresh tokens, sessions, revocation | Why two tokens? How does logging in elsewhere kick out an old token immediately? | PROJECT_ARCHITECTURE_GUIDE §10 | 📖 |
| 4.4 | XSS, CSRF, httpOnly, SameSite, open redirects | Which attack does each of our cookie flags stop? | `_set_refresh_cookie`, login `returnUrl` check | 📖 |
| 4.5 | OAuth 2.0 / OpenID Connect, Google Sign-In | What exactly does Google send us, and how do we know it's really from Google? | PROJECT_ARCHITECTURE_GUIDE §15 | 📖 |

## Module 5: Real-time systems

📖 **Lessons: [learning/module-5-realtime.md](learning/module-5-realtime.md)**

| # | Topic | You should be able to answer | Where | Status |
|---|---|---|---|---|
| 5.1 | Polling vs long-polling vs SSE vs WebSockets | Why WebSockets for prices? When would SSE be enough? | [ws.py](../backend/app/routers/ws.py) | 📖 |
| 5.2 | WebSocket lifecycle, reconnection, backoff + jitter | What happens when the server restarts? What's a thundering herd? | [websocket-price-feed.ts](../frontend/src/app/core/services/websocket-price-feed.ts) | 📖 |
| 5.3 | Pub-sub and fan-out, Redis | Why does Binance get only one connection no matter how many users? | [broker.py](../backend/app/realtime/broker.py), [hub.py](../backend/app/realtime/hub.py) | 📖 |
| 5.4 | Backpressure & slow consumers | What happens if one client's network is slow? | [client.py](../backend/app/realtime/client.py), fixed in 8.3 | 📖 |

## Module 6: Infrastructure & DevOps

📖 **Lessons: [learning/module-6-infrastructure.md](learning/module-6-infrastructure.md)**

| # | Topic | You should be able to answer | Where | Status |
|---|---|---|---|---|
| 6.1 | Containers & Docker images, layers, multi-stage builds | What's the difference between an image and a container? Why two stages in our Dockerfile? | [Dockerfile](../frontend/Dockerfile), [backend/Dockerfile](../backend/Dockerfile) | 📖 |
| 6.2 | docker compose, networks, volumes, env vars | How does the backend find Redis by the name `redis`? Where does the SQLite file survive restarts? | [docker-compose.yml](../docker-compose.yml) | 📖 |
| 6.3 | nginx as static server + reverse proxy | Why does nginx sit in front? What does the WebSocket "Upgrade" header do? | [nginx.conf](../frontend/nginx.conf) | 📖 |
| 6.4 | Configuration & secrets (12-factor) | Why is `JWT_SECRET` an env var, and why is the Google client ID not a secret? | [config.py](../backend/app/config.py) | 📖 |
| 6.5 | Observability: logs, metrics, health checks | How would you know the Binance feed is down in production? | `/api/health`, feed logs | 📖 |

## Module 7: Scale, cost, and system design

📖 **Lessons: [learning/module-7-scale.md](learning/module-7-scale.md)**

| # | Topic | You should be able to answer | Status |
|---|---|---|---|
| 7.1 | Vertical vs horizontal scaling, stateless services, load balancers | Which parts of our backend are stateless and which aren't? | 📖 |
| 7.2 | The "1 million users" walkthrough | Walk an interviewer through it in 5 minutes | 📖 |
| 7.3 | Caching & CDNs | What can a CDN cache here, and what can't it? | 📖 |
| 7.4 | Cost thinking | What would dominate the cloud bill at 1M users? | 📖 |

## Module 8: Real-world features (built to fix real gaps)

📖 **Lessons: [learning/module-8-real-world-features.md](learning/module-8-real-world-features.md)**

| # | Topic | You should be able to answer | Status |
|---|---|---|---|
| 8.1 | Server-side alerts, idempotency | How does an alert fire exactly once with several servers? Why can't the browser do it? | 📖 |
| 8.2 | Latency tracing, percentiles, clock sync | Why p95 not the average? How do you time across two machines with different clocks? Where does your latency go? | 📖 |
| 8.3 | Load testing, conflation, capacity | What breaks first under load? What is conflation and when is it wrong? How many users per server, measured? | 📖 |
| 8.4 | CI pipeline | What does your CI check? CI vs CD? Why no outside services in tests? | 📖 |

---

## Scale to 1 million users (summary)

Full walkthrough, capacity maths and cost: **[learning/module-7-scale.md](learning/module-7-scale.md)**.

**The one-sentence answer:** *"Split ingestion from delivery, make the WebSocket tier horizontally scalable behind a load balancer with Redis pub-sub in between, move static files to a CDN and auth state to Postgres + Redis, and cut per-client bandwidth with batching, compact encoding and compression, because at that size egress is the bottleneck and the main cost."*

---

## Interview question bank

Where each answer lives is in brackets. Practise saying them out loud.

1. Walk me through what happens from the moment I open the app until I see a live BTC price. [0.1, 2.1, 5.1–5.3]
2. Why did you choose Angular signals *and* RxJS? Isn't one enough? [2.4, 2.5]
3. What's the difference between OnPush and default change detection, and what does "zoneless" mean? [2.3]
4. How does your app avoid re-rendering 25 times per second? [0.4, 2.10, ANGULAR guide §27]
5. Why WebSockets instead of polling every second? What about Server-Sent Events? [5.1]
6. What happens to a connected user when your backend restarts? Show me the code. [5.2]
7. Explain pub-sub. Why Redis? What happens if Redis goes down? [5.3]
8. Why does Binance only see one connection no matter how many users are online? [5.3]
9. Where is the access token stored, where is the refresh token, and why? [0.5, 4.3]
10. An attacker steals the refresh cookie. What can they do, and how would you limit it? [4.3, 4.4]
11. How do you know a Google ID token is genuine and meant for your app? [4.5]
12. Why argon2 for passwords but plain SHA-256 for refresh tokens? [4.1, 4.3]
13. How did you prove virtual scrolling helps? What were the numbers? [0.2, 0.3, 2.10]
14. Your SQLite database: when would you move off it, and how would you migrate? [3.5]
15. Scale this to 1 million concurrent users. What breaks first, and what do you change? [7.2]
16. What would your cloud bill look like at that size, and what dominates it? [7.4]
17. What are the known weaknesses of your project today? (Tech-Debt Backlog: be honest) [PROJECT_ARCHITECTURE_GUIDE Tech-Debt Backlog §7, §14, §15]
