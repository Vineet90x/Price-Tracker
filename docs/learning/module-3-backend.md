# Module 3: Backend (Python, FastAPI, databases)

[← Learning path](../LEARNING_PATH.md) · Previous: [Module 2](module-2-angular.md) · Next: [Module 4: Security](module-4-security.md)

The frontend runs on the user's device, where anyone can read and change it. The **backend** runs on *our*
server: it's the only place we can trust to check passwords, store data and talk to Binance. Ours lives in
[`backend/`](../../backend).

---

## 3.1 Python basics for a JavaScript developer

**What it is.** Python is another general-purpose language. Different spelling, very similar ideas.

| Idea | JavaScript | Python (in our code) |
|---|---|---|
| Import | `import { x } from './y'` | `from .db import get_db` |
| Object / map | `{ BTC: 'btcusdt' }` | dict `{"BTC": "btcusdt"}` [symbols.py:L4](../../backend/app/symbols.py#L4) |
| Template string | `` `prices:${s}` `` | f-string `f"prices:{symbol}"` |
| `null` | `null` / `undefined` | `None` |
| Blocks | `{ … }` | **indentation** (4 spaces); no braces |
| Async | `async function` / `await` | `async def` / `await` [feeds.py:L40](../../backend/app/realtime/feeds.py#L40) |
| Decorator | `@Component({...})` (TS) | `@router.post("/login")`, which wraps/registers the function below it [auth.py:L97](../../backend/app/routers/auth.py#L97) |
| Types | TypeScript types | **type hints** `def login(body: Credentials)`, not enforced by Python itself, but FastAPI/Pydantic *use* them to validate data |
| Class with fields | `class X { a = 1 }` | `@dataclass` [config.py:L12](../../backend/app/config.py#L12) |

**How it works.** Python is interpreted: `python` reads `.py` files and runs them; there's no build step like
TypeScript's. A folder with `__init__.py` is a *package*, and `app.routers.auth` means the file `app/routers/auth.py`.

**Why we chose it.** The build guide picks FastAPI (Python): excellent async + WebSocket support, automatic
validation from type hints, and Python is the most common language for data work and interviews.

**How it helps.** The backend reads almost like pseudocode: ~840 lines for auth, WebSockets, feeds and Redis.

**At large scale.** Python is slower per CPU-second than Go/Java/Rust. For **I/O-bound** work like ours (waiting
on network and sockets) that rarely matters; for CPU-heavy hot paths, teams scale out with more processes or
rewrite that one service in a faster language.

**Interview angle.** *"Why Python for a real-time backend?"* The work is I/O-bound; async Python handles many
idle connections well. Know its limit: the **GIL** (one thread runs Python bytecode at a time), so CPU-heavy
work needs processes, not threads.

---

## 3.2 Virtual environments and `requirements.txt`

**What it is.** In Node, every project gets its own `node_modules` folder automatically. Python, by default,
installs packages **globally**, shared by every project on the machine. If project A needs FastAPI 0.115 and project
B needs 0.90, they'd fight. A **virtual environment** ("venv") is a private, per-project copy of Python plus
its own package folder: Python's `node_modules`.

**How it works.**
```bash
py -3.12 -m venv .venv            # create: a folder with its own python.exe and site-packages
.venv\Scripts\activate            # use it in this terminal (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt   # install the exact versions listed
```
**`requirements.txt`** is our shopping list with **exact** versions (`==`) [requirements.txt:L1](../../backend/requirements.txt#L1),
Python's equivalent of package.json **and** the lock file in one (only top-level packages pinned, though).

**Example from our project.**
- In **Docker** we don't need a venv: the container *is* the isolated environment. The image installs exactly
  `requirements.txt` [Dockerfile:L10](../../backend/Dockerfile#L10).
- When Docker couldn't download images (the network outage while adding Google login), I tested the backend in
  a **venv** in a temp folder: same packages, isolated from everything else on your machine, deleted afterwards.
- Your machine has three Pythons (3.6, 3.12, 3.14): exactly the kind of mess venvs and containers protect you from.

**Why we chose it.** Docker for running (same everywhere), venv for quick local testing.

**How it helps.** Reproducible installs; "works on my machine" becomes "works on every machine".

**At large scale.** Pin *everything*, including dependencies of dependencies, with a lock tool (`pip-tools`,
`uv`, Poetry); scan for vulnerable versions in CI; build one image and promote the same image through
staging → production.

**Interview angle.** *"Why do you need a virtual environment?"* Per-project isolation of package versions.
*"venv vs Docker?"* A venv isolates Python packages; a container isolates the whole OS userland (Python
version, system libraries, files, network).

---

## 3.3 FastAPI: routes, dependencies (`Depends`), Pydantic validation

**What it is.** A web framework: it receives HTTP requests and calls the Python function registered for that
method + path, like a receptionist routing calls to the right desk.

**How it works: the life of `POST /api/auth/login`.**
1. Uvicorn (3.4) receives the HTTP request and hands it to FastAPI [main.py:L51](../../backend/app/main.py#L51).
2. FastAPI finds the route among the included routers [main.py:L52-L55](../../backend/app/main.py#L52-L55).
3. The JSON body is parsed and **validated against a Pydantic model** [auth.py:L41-L43](../../backend/app/routers/auth.py#L41-L43)
   (email pattern, password 8–128 chars). Invalid → automatic **422** with details; our function never runs.
4. **Dependencies** are resolved: `db: Session = Depends(get_db)` means "before calling me, run `get_db`"
   [db.py:L54-L60](../../backend/app/db.py#L54-L60). It opens a DB session, `yield`s it to the endpoint, and **closes it after
   the response**, even if the endpoint crashes.
5. Our function runs [auth.py:L98](../../backend/app/routers/auth.py#L98) and returns a Pydantic model → FastAPI turns it into JSON.

**`Depends` is DI again** (compare 2.2). `get_current_user` [deps.py:L23-L44](../../backend/app/deps.py#L23-L44)
is a dependency that reads the `Authorization` header, verifies the token and loads the user. Any endpoint
that needs a logged-in user just declares `user: User = Depends(get_current_user)`, e.g. the portfolio
[portfolio.py:L34](../../backend/app/routers/portfolio.py#L34).

**Why we chose it.** Validation and API docs come from type hints (open `http://localhost:8000/docs` for an
interactive API page generated automatically), plus first-class async and WebSockets.

**How it helps.** Bad input is rejected before our code runs; auth is one reusable line per endpoint.

**At large scale.** The same app runs as many identical **stateless** instances behind a load balancer (all
state is in the DB/Redis). Add request IDs, structured logs and rate limits as middleware.

**Interview angle.** *"How does FastAPI validate input?"* Pydantic models from type hints → 422 on mismatch.
*"What is `Depends`?"* Dependency injection: reusable setup/teardown per request (DB session, current user).

---

## 3.4 ASGI, uvicorn, async I/O

**What it is.** **Uvicorn** is the actual server program: it owns the network sockets and speaks HTTP and
WebSocket. **ASGI** is the standard plug shape between such a server and a framework like FastAPI (the async
successor of WSGI). `async`/`await` is the same event-loop idea as JavaScript (0.4), in Python's `asyncio`.

**How it works.**
- One uvicorn process runs **one event loop**. While a coroutine awaits the network (`await ws.receive_json()`
  [ws.py:L48](../../backend/app/routers/ws.py#L48)), the loop serves other connections. That's how one
  process holds thousands of mostly idle WebSockets.
- **Blocking code must not run on the loop.** FastAPI runs plain `def` endpoints (our auth endpoints: SQLite
  queries + Argon2 hashing, which take tens of ms of CPU [security.py:L14](../../backend/app/security.py#L14))
  in a **thread pool**, so the loop stays free. `async def` endpoints run *on* the loop.
- Long-running background work starts in `lifespan` [main.py:L24-L43](../../backend/app/main.py#L24-L43): the Redis
  listener, the simulated feed and the Binance feed run as asyncio **tasks**, restarted with backoff if they crash
  [feeds.py:L20](../../backend/app/realtime/feeds.py#L20).

**Why we chose it.** Real-time = many concurrent, mostly idle connections. Async I/O is the efficient model for that.

**How it helps.** One small container handles all our WebSockets *and* the feeds.

**At large scale.**
- One Python process uses **one CPU core** for Python code. Use `uvicorn --workers N` (or more containers) to use
  more cores, but **each worker would start its own feeds** (duplicate Binance sockets, Backlog #20). That's why
  feeds should move to a separate worker.
- A single accidental blocking call (e.g. a synchronous HTTP request inside `async def`) stalls **every**
  connection in that process. Watch for it in code review.

**Interview angle.** *"How does one Python process handle 10,000 WebSockets?"* An event loop with non-blocking I/O;
idle sockets cost only memory. *"`def` vs `async def` in FastAPI?"* Thread pool vs event loop; never block the loop.

---

## 3.5 SQL, SQLite, SQLAlchemy, migrations

**What it is.**
- A **relational database** stores data in **tables** (like spreadsheets): rows = records, columns = fields.
  **SQL** is the language to query them (`SELECT * FROM users WHERE email = '…'`).
- **SQLite** is a whole SQL database in **one file** (`/app/data/app.db` in a Docker volume): no separate server.
- **SQLAlchemy** is an **ORM** (object-relational mapper): you write Python classes and queries, and it writes the SQL.
- A **migration** is a versioned change to the table structure (schema) that existing data survives.

**How it works in our project.**
- Two tables: `users` [models.py:L15-L24](../../backend/app/models.py#L15-L24) and `sessions`
  [models.py:L27](../../backend/app/models.py#L27). `sessions.user_id` is a **foreign key** pointing at `users.id`.
- **Indexes** (e.g. unique on `email`, on `token_hash`) work like a book's index: finding a row by email is a quick
  lookup instead of reading every row. `unique` also guarantees no duplicate emails.
- Query example: `select(User).where(User.email == email)` [auth.py:L89](../../backend/app/routers/auth.py#L89)
  becomes `SELECT … FROM users WHERE users.email = ?`. The `?` placeholder means user input is **never pasted into
  SQL text**, which prevents **SQL injection**.
- **Transactions:** changes become permanent only on `db.commit()`; a crash before that leaves the DB unchanged.
- **Migration:** Google login needed a nullable `password_hash` and a new `google_sub` column. `create_all()`
  only creates *missing tables*; it never alters existing ones. So `migrate()` rebuilds the table and copies
  the rows, inside one transaction [db.py:L27](../../backend/app/db.py#L27). In production you'd use **Alembic**, which
  generates and versions these scripts.

**Why we chose it.** SQLite needs zero setup and is plenty for one backend instance (the build guide says so too).

**How it helps.** Real relational guarantees (unique emails, foreign keys, transactions) with no extra service to run.

**At large scale.**
- SQLite allows **one writer at a time** and lives on one machine's disk, so several backend instances can't share
  it. Move to **PostgreSQL** (Backlog #22): a server many instances connect to.
- **Connection pooling** (each instance keeps a few open connections; PgBouncer in front for hundreds of instances).
- **Read replicas** for read-heavy traffic; **Redis** to cache hot lookups such as the per-request session check.
- **Zero-downtime migrations** ("expand → migrate data → contract"): add the new column first, deploy code that
  writes both, backfill, then remove the old one.

**Interview angle.** *"What does an index cost?"* Faster reads, slightly slower writes, plus disk space.
*"How do you prevent SQL injection?"* Parameterised queries (an ORM does it for you). *"When would you leave
SQLite?"* As soon as more than one server must write, or you need concurrent writes and high availability.
*"How do you change a schema without downtime?"* Expand/contract migrations.
