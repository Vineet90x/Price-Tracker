# Module 6: Infrastructure and DevOps

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 5](module-5-realtime.md) · Next: [Module 7: Scale & cost](module-7-scale.md)

How the code becomes running software, the same way on every machine, and how you'd know when it breaks.

```
your machine :4200 ──► [nginx container] ──/api──► [backend container] ──► [redis container]
                         static files              FastAPI :8000           :6379
                                                    └─ volume: app.db (SQLite)
```

---

## 6.1 Containers and Docker images

**What it is.**
- An **image** is a frozen, ready-to-run package: an OS userland (e.g. Alpine Linux), the language runtime, our code
  and its dependencies. Like a **recipe plus all the pre-measured ingredients**.
- A **container** is a running instance of an image: an isolated process with its own filesystem and network.
  Like the **dish** cooked from the recipe; you can cook many from one recipe.
- Not a virtual machine: containers share the host's kernel, so they start in about a second and use little memory.
  (On Windows/Mac, Docker Desktop runs one small Linux VM that hosts all containers. That's why Docker's network
  could fail while your Windows network worked during the Google-login work.)

**How it works.**
- A **Dockerfile** is the recipe, one instruction per step. Each step becomes a cached **layer**. If a step's inputs
  didn't change, Docker reuses the layer.
- **Layer-ordering trick:** copy only the dependency list first and install, *then* copy the source
  [Dockerfile:L7-L11](../../frontend/Dockerfile#L7-L11). Editing a `.ts` file then doesn't re-run the slow `npm ci`.
  The backend does the same with `requirements.txt` [Dockerfile:L9-L10](../../backend/Dockerfile#L9-L10).
- **Multi-stage build** (frontend): stage 1 uses a big Node image to build [Dockerfile:L2](../../frontend/Dockerfile#L2);
  stage 2 starts fresh from small nginx [Dockerfile:L17](../../frontend/Dockerfile#L17) and copies **only** the built files.
  Node, `node_modules` and the source never reach production. Result: our frontend image is **105 MB**; the backend
  image (Python + libraries) is **292 MB**.
- `.dockerignore` keeps `node_modules`, `dist` and `.git` out of the build context [.dockerignore:L1](../../frontend/.dockerignore#L1).
- **Least privilege:** the backend runs as a non-root user [Dockerfile:L18](../../backend/Dockerfile#L18).

**Why we chose it.** "It works on my machine" stops being a problem: the image *is* the machine.

**How it helps.** One command starts the whole stack on any computer with Docker; the same image can run in the cloud.

**At large scale.** Build the image **once** in CI, tag it with the commit hash, push it to a **registry** (Docker Hub,
GHCR, ECR), scan it for vulnerabilities, and deploy that exact image to staging, then production. Orchestrators
(**Kubernetes**, AWS ECS, Cloud Run) run many copies, restart crashed ones, and roll out new versions gradually.

**Interview angle.** *"Image vs container?"* Template vs running instance. *"Container vs VM?"* Shared kernel,
lightweight; a VM has its own kernel. *"Why multi-stage builds?"* Small, secure runtime images without build tools.
*"Why order Dockerfile steps carefully?"* Layer caching.

---

## 6.2 docker compose: services, networks, volumes, environment

**What it is.** One file describing **several containers that work together** and how they connect
([docker-compose.yml](../../docker-compose.yml)). `docker compose up -d --build` builds and starts them all.

**How it works.**
- **Services:** `redis` [docker-compose.yml:L3](../../docker-compose.yml#L3), `backend` [docker-compose.yml:L16](../../docker-compose.yml#L16), `price-tracker` (nginx).
- **Networking and DNS:** compose creates a private network (`price-tracker_default`). Each service is reachable
  **by its name**: the backend connects to `redis://redis:6379` [docker-compose.yml:L20](../../docker-compose.yml#L20),
  and inside the backend container `redis` resolves to `172.18.0.2`. nginx reaches `http://backend:8000` the same way.
- **Ports** `"HOST:CONTAINER"`: `"4200:80"` [docker-compose.yml:L45](../../docker-compose.yml#L45) exposes nginx's port 80 as port 4200 on your machine.
- **Volumes:** a container's filesystem is thrown away when it's recreated. The SQLite file lives in a named volume
  (`price-tracker_backend-data`) mounted at `/app/data` [docker-compose.yml:L30](../../docker-compose.yml#L30), so users
  survive rebuilds (they did: the Google-login migration ran on the existing 4 accounts).
- **Startup order:** the backend waits until Redis is actually **healthy** (`redis-cli ping` answers)
  [docker-compose.yml:L8-L12](../../docker-compose.yml#L8-L12) [docker-compose.yml:L35](../../docker-compose.yml#L35), not merely started.
- **Environment variables** with defaults: `${ACCESS_TOKEN_SECONDS:-900}` means "use the variable if set, else 900".
  That's how we ran tests with 5-second tokens: `ACCESS_TOKEN_SECONDS=5 docker compose up -d backend`.

**Why we chose it.** Three cooperating services, one command, reproducible.

**How it helps.** Local development matches production layout (proxy → API → Redis).

**At large scale.** Compose is for one machine. In production the same ideas map to Kubernetes objects
(Deployments = services, Services = DNS names, PersistentVolumes = volumes, Secrets/ConfigMaps = env) or to managed
services: you'd use **managed Redis** and **managed Postgres** instead of containers holding data.

**Interview angle.** *"How does the backend find Redis?"* Compose's internal DNS by service name. *"Where does data
survive a container restart?"* In volumes. *"depends_on vs healthcheck?"* Started vs actually ready.

---

## 6.3 nginx: static file server and reverse proxy

**What it is.** A very fast, battle-tested web server. Ours does two jobs: hands out the built frontend files, and
forwards `/api` traffic to the backend (a **reverse proxy**: it sits in front of servers, in contrast to a forward
proxy, which sits in front of clients).

**How it works** ([nginx.conf](../../frontend/nginx.conf)):
- **SPA routing:** for `/portfolio` there's no such file, so serve the app shell and let Angular's router decide
  [nginx.conf:L20](../../frontend/nginx.conf#L20).
- **Reverse proxy + WebSocket upgrade** [nginx.conf:L25-L33](../../frontend/nginx.conf#L25-L33): forwards the request, passes
  the `Upgrade`/`Connection` headers (the `map` turns "client asked to upgrade" into `Connection: upgrade`
  [nginx.conf:L2-L5](../../frontend/nginx.conf#L2-L5)), and allows WebSockets to stay idle for up to an hour.
- **Caching:** hashed JS/CSS files are cacheable for a year [nginx.conf:L38](../../frontend/nginx.conf#L38).
- **Compression:** gzip shrinks text responses (576 kB of JS → ~141 kB over the wire) [nginx.conf:L48](../../frontend/nginx.conf#L48).
- **A real bug we fixed:** nginx built *absolute* redirect URLs with its internal port 80, so `localhost:4200/watchlist`
  redirected to `localhost/watchlist/` (dead). Fixed with `absolute_redirect off` [nginx.conf:L15](../../frontend/nginx.conf#L15).
  The lesson: **a proxy doesn't know the public address unless you tell it.**

**Why we chose it.** One origin for app + API (no CORS, simple cookies, see 0.5), and nginx is far better at serving
files and holding connections than Python.

**How it helps.** The backend only does backend work; static traffic never touches Python.

**At large scale.** The same roles split up: a **CDN** for static files; a cloud **load balancer** (or nginx/Envoy
fleet) terminating TLS and spreading `/api` and WebSocket traffic across many backend instances, with health
checks. Known issue to fix first: security headers are dropped on some responses (Backlog #14).

**Interview angle.** *"What is a reverse proxy and why use one?"* A single entry point: TLS, routing, caching,
compression, load balancing, hiding internal services. *"What does a WebSocket need from a proxy?"* Forwarding the
Upgrade headers, HTTP/1.1, long idle timeouts.

---

## 6.4 Configuration and secrets (12-factor)

**What it is.** The **12-factor app** rule: the *same* code/image runs everywhere; anything that differs between
environments (URLs, secrets, feature switches) comes from **environment variables**.

**How it works in our project.**
- **Where the values live:** `.env` at the repo root holds the real values for *your* machine and is
  **git-ignored**; [`.env.example`](../../.env.example) is the committed template that explains every variable.
  `docker compose` reads `.env` automatically and passes the values into the backend container. `JWT_SECRET` is
  *required* (`${JWT_SECRET:?…}` in docker-compose.yml): without it, compose refuses to start instead of silently
  using a weak default. New machine: `cp .env.example .env`, then fill it in.
- The frontend has **no** env file on purpose: everything shipped to a browser is public. It gets runtime config
  (e.g. the Google client ID) from `GET /api/auth/config`.
- All backend settings are read from env vars in one place [config.py:L12](../../backend/app/config.py#L12).
- **Secret** (must never leak, never be committed): `JWT_SECRET` [config.py:L14](../../backend/app/config.py#L14). Its dev
  default is fine locally and **dangerous in production** (Backlog #23).
- **Not secret:** the Google client ID [config.py:L25](../../backend/app/config.py#L25). It's sent to every browser
  anyway; security comes from Google's list of allowed origins plus our `aud` check.
- **Environment-dependent:** `COOKIE_SECURE` must be `true` behind HTTPS [config.py:L22](../../backend/app/config.py#L22).

**Why we chose it.** No code change to deploy to a new environment; secrets stay out of git.

**How it helps.** Tests with 5-second tokens, a Binance switch-off, a different database: all without editing code.

**At large scale.** Secrets live in a **secret manager** (AWS Secrets Manager, Vault, Kubernetes Secrets),
injected at runtime, **rotated** regularly, with access audited. Feature flags change behaviour without deploys.

**Interview angle.** *"Where do you keep secrets?"* Env vars from a secret manager, never in the repo or the image.
*"Is an OAuth client ID a secret?"* No; the client *secret* would be.

---

## 6.5 Observability: logs, metrics, health checks

**What it is.** Being able to answer *"is it working, and if not, why?"* from the outside, without attaching a debugger.
Three pillars: **logs** (what happened), **metrics** (numbers over time), **traces** (one request's path across services).

**How it works in our project.**
- **Logs:** the feeds log failures and reconnects [feeds.py:L32](../../backend/app/realtime/feeds.py#L32). That's how we
  saw the DNS failures and the 30 s backoff today: `docker compose logs -f backend`.
- **Health/metrics endpoint:** `/api/health` [main.py:L54](../../backend/app/main.py#L54) returns whether Redis responds
  plus counters (`binance_connections`, `binance_messages`, `published`, `ws_clients`, `ws_messages_sent`).
- **Container health:** compose's Redis healthcheck (6.2).

**Why we chose it.** The cheapest possible observability that still *proves* the fan-out claim.

**How it helps.** "Prices aren't moving" → check health: is Redis up? Is `binance_messages` increasing? Are there feed errors in the logs?

**At large scale.**
- **Metrics** (Prometheus + Grafana): connections per instance, messages/s, **feed lag** (now − tick timestamp),
  login error rate, p95 latency. **Alerts** on them (PagerDuty/Slack).
- **Structured logs** (JSON) shipped to a central store (Loki, ELK, CloudWatch), with a request ID in every line.
- **Tracing** (OpenTelemetry) once there are several services.
- **Liveness vs readiness probes:** "process alive" vs "ready for traffic" (e.g. Redis reachable), so the load
  balancer stops sending users to a broken instance.
- **SLOs:** e.g. "99.9 % of ticks reach clients within 1 s", which sets what you alert on.

**Interview angle.** *"How would you know the Binance feed is down in production?"* An alert on feed lag /
`binance_messages` stalling, not a user complaint. *"Logs vs metrics vs traces?"* Events vs aggregates vs a
request's journey. *"Liveness vs readiness?"* Restart me vs don't route to me.
