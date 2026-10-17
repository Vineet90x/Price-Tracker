# Module 0: How the Web Works

[← Learning path](../LEARNING_PATH.md) · Next: [Module 1: Tooling](module-1-tooling.md)

Everything else in this project sits on top of these six ideas. Each lesson: what it is → how it works → example from our code → why we chose it → how it helps → at large scale → interview angle.

---

### 0.1 Browser → server: what happens when you open `http://localhost:4200/watchlist`

**What it is.** Ordering food by phone. You look up the restaurant's number (**DNS**), dial and wait until
someone picks up (**TCP connection**), speak an agreed language ("one pizza, no onions") (**HTTP request**),
and hear back "OK, 20 minutes" or "sorry, we're closed" (**HTTP response + status code**).

**How it works, step by step, for our app:**

1. **The URL is split into parts.**
   ```
   http  ://  localhost  :  4200  /watchlist  ?scale=200
   scheme     host          port  path        query
   ```
2. **DNS: name → IP address.** Computers connect to numbers, not names. `localhost` is special: it always means
   "this machine" (`127.0.0.1` in IPv4, `::1` in IPv6) and never leaves your computer. For a real domain like
   `google.com`, your computer asks a DNS resolver, which asks the root servers → the `.com` servers →
   Google's own servers, and caches the answer for a while (its *TTL*).
3. **TCP connection to IP:port.** A short "hello / hello back / ok" exchange (the *3-way handshake*) opens a
   reliable two-way pipe. With `https://` a **TLS handshake** follows: the server proves its identity with a
   certificate and both sides agree on encryption keys. Locally we use plain `http`; in production it must be
   `https` (that's why the refresh cookie has a `COOKIE_SECURE` switch).
4. **The HTTP request** is just text sent down that pipe. This is what curl actually sent to our app:
   ```
   > GET /watchlist HTTP/1.1
   > Host: localhost:4200
   ```
   A request = **method** (`GET`) + **path** + **headers** (`Host`, `Cookie`, `Authorization`, …) + optional **body**.
5. **Who answers?** Port 4200 on your machine is mapped by Docker to port 80 inside the nginx container
   ([docker-compose.yml:L45](../../docker-compose.yml#L45)). nginx looks for a matching file
   ([nginx.conf:L20](../../frontend/nginx.conf#L20)): `/watchlist` → the prerendered `watchlist/index.html`.
6. **The HTTP response:** a status line, headers, a body. The real one:
   ```
   < HTTP/1.1 200 OK
   < Content-Type: text/html
   < Content-Length: 56319
   ```
7. **The HTML asks for more.** The browser reads the HTML, finds `<script>` and `<link>` tags and requests those
   files too (JavaScript chunks, CSS, fonts). The same TCP connection is reused (*keep-alive*) to avoid
   repeating step 3.
8. **Angular starts and calls the API.** Before showing the first page, the app asks "am I still logged in?"
   ([app.config.ts:L34](../../frontend/src/app/app.config.ts#L34)), which means `POST /api/auth/refresh`. nginx sees the
   `/api/` prefix and **forwards** the request to the backend container ([nginx.conf:L25](../../frontend/nginx.conf#L25)).
   This is called a *reverse proxy*. FastAPI answers `200` (logged in) or `401` (not logged in).
9. **The WebSocket upgrade.** To receive live prices the app sends one more HTTP request, this time saying
   "let's switch protocols". The real server reply:
   ```
   HTTP/1.1 101 Switching Protocols
   Upgrade: websocket
   Connection: upgrade
   ```
   From now on that connection is no longer request → response: both sides can send messages whenever they
   want (Module 5).

**Status codes you'll meet in this project:**

| Code | Meaning | Where we produce it |
|---|---|---|
| 200 OK | Worked, here's the data | login, refresh, `/me`, `/portfolio` |
| 201 Created | A new thing was created | register ([auth.py:L86](../../backend/app/routers/auth.py#L86)) |
| 204 No Content | Worked, nothing to send back | logout ([auth.py:L189](../../backend/app/routers/auth.py#L189)) |
| 101 Switching Protocols | HTTP becomes a WebSocket | `/api/ws/prices` |
| 301 Moved Permanently | "Go to this other URL instead" | the nginx bug we fixed: it redirected `/watchlist` to port 80 (PROJECT_ARCHITECTURE_GUIDE §12) |
| 401 Unauthorized | "I don't know who you are" (no/expired/invalid token) | refresh without cookie, expired access token |
| 403 Forbidden | "I know who you are, but you're not allowed" | not used yet: e.g. a normal user calling an admin endpoint |
| 404 Not Found | No such URL | unknown `/api/...` paths |
| 409 Conflict | Clashes with existing data | email already registered ([auth.py:L90](../../backend/app/routers/auth.py#L90)) |
| 422 Unprocessable Entity | Request understood, data invalid | register with email `"bad"` and password `"x"`: real reply `HTTP/1.1 422 Unprocessable Entity` |
| 502 Bad Gateway | The proxy couldn't reach the server behind it | nginx running but the backend container down |

**Why we chose it.** HTTP itself isn't a choice; it *is* the web. The choices we did make: put the API **behind
the same address** as the app (step 8, see 0.5 for why), and use a WebSocket only for the live prices,
where request → response doesn't fit.

**How it helps.** When something breaks, you can ask "which step failed?" and check it in DevTools → **Network**:
no request at all (JS problem), request with 502 (backend down), 401 (auth), 200 but wrong data (logic).

**At large scale.**
- **Distance costs time.** One round trip Mumbai ↔ US East is ~200 ms; a fresh HTTPS connection needs several
  round trips before the first byte. Fix: a **CDN** serves the static files from a server near the user, and
  only `/api` goes to the origin.
- **Handshakes cost CPU.** TLS is terminated once at a **load balancer**, connections are kept alive, and
  HTTP/2 or HTTP/3 send many requests over one connection.
- **DNS** can route users to the nearest region (GeoDNS / anycast).

**Interview angle.**
- *"What happens when you type a URL and press Enter?"* Walk through steps 1–9 above. Mentioning the
  reverse proxy and the WebSocket upgrade from **your own project** makes the classic answer concrete.
- *"401 vs 403?"* 401: we don't know who you are (log in / refresh). 403: we know who you are, and the answer is no.
- *"When do you get a 502?"* When a proxy (our nginx) can't get an answer from the server behind it.

---

### 0.2 The DOM

**What it is.** When the browser reads your HTML, it doesn't keep it as text. It builds a **tree of objects in
memory**, one object per element, and that tree is the **DOM** (Document Object Model). Think of the HTML file as
the architect's drawing and the DOM as the actual building: JavaScript can walk into the building and move
the furniture (`element.textContent = '81,500'`), and the screen updates.

**How it works.** HTML text → parser → DOM tree (objects with properties and children). CSS is turned into a
similar tree of rules. The browser then (1) works out which styles apply to each element (*style
recalculation*), (2) computes sizes and positions (*layout*), and (3) draws pixels (*paint*). Changing the DOM
can force some or all of these steps to run again, and that's the "expensive" part, not the JavaScript itself.

**Example from our code.** Each watchlist row is a handful of DOM elements
([watchlist-row.ts](../../frontend/src/app/features/watchlist/components/watchlist-row.ts)). On every tick Angular updates the
price text and flash class in those elements. With 205 rows in the DOM the browser spent ~645 ms per 10 s on
style recalculation; with only 24 rows (virtual scrolling) ~95 ms
([measured in Step 7](../PROJECT_ARCHITECTURE_GUIDE.md#9-phase-1-step-7-scale-test--virtual-scrolling-)).

**Why we chose (to care about) it.** We can't avoid the DOM; we can only touch less of it. That's why the app uses
`OnPush` + signals (only update what changed), `track` in loops (reuse elements instead of recreating them), and
virtual scrolling (keep only visible rows in the DOM).

**How it helps.** Fewer DOM changes → less style/layout/paint work → smooth scrolling and lower battery use,
which matters most on phones.

**At large scale.** "Scale" on the frontend means *more data per screen*, not more users: 1,000 symbols, or
10 updates per second each. Then: keep virtual scrolling, batch updates (we already use `auditTime(250)`),
and if needed move tick processing off the main thread into a Web Worker, or draw dense tables on a
`<canvas>` (like the chart does) instead of DOM elements.

**Interview angle.**
- *"What is the virtual DOM, and does Angular use one?"* React keeps a virtual copy of the tree and diffs it.
  Angular doesn't: it compiles templates into code that updates exactly the bound DOM nodes, and signals
  tell it which components to check.
- *"Why is reading `offsetHeight` right after changing styles slow?"* It forces a synchronous layout
  (layout thrashing).
- *"How would you render 100,000 rows?"* Virtual scrolling, plus a fixed row height, plus pagination or
  server-side filtering. Measure before and after.

---

### 0.3 How the browser renders: style → layout → paint → composite

**What it is.** An assembly line that runs every time something on screen changes:
1. **Style**: which CSS rules apply to each element ("this row is green").
2. **Layout** (also called *reflow*): how big each element is and where it goes.
3. **Paint**: fill in the pixels (text, colours, borders).
4. **Composite**: stack the painted layers on the screen; usually done by the GPU.

**How it works.** For smooth motion the screen redraws about 60 times a second, so each frame has a
**~16.7 ms budget**. JavaScript, style, layout and paint all share the *same* main thread. If JavaScript +
rendering take longer than the budget, a frame is skipped, and you see stutter ("jank").
Not every change costs the same:

| You change… | Steps that re-run | Cost |
|---|---|---|
| width, height, text content, adding/removing elements | style → layout → paint → composite | highest |
| colour, background-color | style → paint → composite | medium |
| `transform`, `opacity` | composite only (often on the GPU) | lowest |

**Example from our code.**
- The tick **flash** animates `background-color` ([styles.css:L36](../../frontend/src/styles.css#L36)), so every flashing row
  is repainted on every animation frame. That's fine for ~24 visible rows.
- The **toast** slides in with `transform` + `opacity` ([styles.css:L52-L59](../../frontend/src/styles.css#L52-L59)):
  composite-only, the cheapest kind of animation.
- **Step 7 showed this assembly line in numbers.** On every tick, ~205 rows change text and flash class; with all of them in the
  DOM, style recalculation took ~645 ms per 10 s and layout ~230 ms; with virtual scrolling (24 rows) ~95 ms and
  ~38 ms ([measurements](../PROJECT_ARCHITECTURE_GUIDE.md#9-phase-1-step-7-scale-test--virtual-scrolling-)).

**Why we chose it.** We use CSS animations (the browser runs and optimises them) rather than changing styles from
JavaScript on every frame, and we keep fewer elements in the DOM (virtual scrolling). The CDK viewport also
sets `contain: strict`, which tells the browser "nothing inside this box affects layout outside it", so its
work stays local.

**How it helps.** Less work per frame → no stutter while prices tick and you scroll, and less battery drain on phones.

**At large scale (more data on one screen).**
- Animate only `transform`/`opacity`: the flash could be a semi-transparent overlay whose **opacity** fades,
  instead of a `background-color` change (composite-only instead of paint).
- For thousands of fast-changing cells, draw on a `<canvas>` (like our chart does) instead of using DOM elements.
- Measure with DevTools → Performance before and after, as we did in Step 7.

**Interview angle.**
- *"Reflow vs repaint?"* Reflow (layout) = sizes/positions recalculated, the expensive one. Repaint = pixels
  redrawn without geometry changing.
- *"What is layout thrashing?"* Alternating writes and reads in a loop (`el.style.width = …; el.offsetHeight`):
  every read forces a synchronous layout. Fix: do all reads first, then all writes.
- *"Why animate `transform` instead of `left`?"* `left` triggers layout every frame; `transform` is composite-only.

---

### 0.4 The JavaScript event loop, async, Promises

**What it is.** A restaurant with **one cook** (JavaScript has a single main thread). The cook never does two
things at once. While the oven bakes (a network request, a timer), the cook takes the next order ticket
instead of standing and waiting. When the oven beeps, a new ticket goes on the rail.

**How it works.**
- **Call stack**: the function running right now. Only one at a time.
- **The browser's helpers** (timers, network, WebSockets) work *outside* JavaScript. When they finish, they put a
  **task** (a "macrotask") in a queue: "timer fired", "WebSocket message arrived", "user clicked".
- **The event loop** repeats: take one task → run it to completion → run **all microtasks**
  (`Promise.then`, the code after an `await`) → maybe render a frame → next task.
- So nothing can interrupt running code. A long-running task blocks clicks, rendering and everything else.

```js
console.log('1 sync');
setTimeout(() => console.log('4 timeout: a task'), 0);
Promise.resolve().then(() => console.log('3 microtask'));
console.log('2 sync');
// prints 1, 2, 3, 4: microtasks run before the next task, even a 0 ms timer
```

**Example from our code.**
- **Every WebSocket message is one task.** Inside it, RxJS runs our pipeline synchronously: `tap` updates the
  price maps, then `auditTime(250)` ([price.service.ts:L66](../../frontend/src/app/core/services/price.service.ts#L66)) starts a
  250 ms timer instead of rendering. When that timer task fires, one snapshot is emitted → the signal changes
  → Angular schedules one round of change detection → the DOM updates → the browser renders.
  Result: ~25 message tasks per second, but only ~4 renders.
- **`setTimeout(…, 150)` in the search box** ([watchlist.ts:L282](../../frontend/src/app/features/watchlist/watchlist.ts#L282)):
  `blur` fires *before* a click on a dropdown item is processed. Closing the dropdown in a later task gives the
  click a chance to land first. (The dropdown's `mousedown` `preventDefault` also helps.)
- **Startup waits for a Promise**: `provideAppInitializer` returns `restoreSession()`'s Promise and Angular
  doesn't navigate until it resolves ([app.config.ts:L34](../../frontend/src/app/app.config.ts#L34)).

**Why it's like this.** One thread means no two pieces of code can change the same data at the same moment, so
there's no locking. The price is that you must never block the thread.

**How it helps.** It explains *why* batching works (fewer render tasks), why a slow loop freezes the page, and how
one tab can keep a WebSocket, timers and clicks going "at the same time" without threads.

**At large scale.**
- **Browser:** heavy processing (e.g. parsing 10,000 ticks/s) moves to a **Web Worker**, a separate thread with
  its own event loop that talks to the page via `postMessage`.
- **Server:** our FastAPI backend uses the same model (Python `asyncio`, Module 3.4). One blocking call inside
  an `async def` stalls *every* WebSocket on that process. That's why one process can hold thousands of idle
  connections, and also why it can be frozen by a single slow, blocking function.

**Interview angle.**
- *"Microtask vs macrotask: what runs first?"* The current task finishes, then *all* microtasks, then the next task.
- *"Does `setTimeout(fn, 0)` run immediately?"* No: at the earliest after the current task and all microtasks.
- *"Why is Node/async Python good at many connections?"* Waiting costs nothing: one thread switches to whatever is ready.

---

### 0.5 Cookies, same-origin, CORS, SameSite

**What it is.** An **origin** is *scheme + host + port*. `http://localhost:4200` and `http://localhost:8000`
are **different origins** (different port). Think of an apartment building: each flat (origin) has its own
mailbox, and a script living in flat A must not be able to read flat B's mail.

**How it works.**
- **Same-origin policy:** a page's JavaScript may *send* requests anywhere, but may only *read* a response from
  another origin if that server explicitly allows it with **CORS** headers (`Access-Control-Allow-Origin`, …).
  For JSON POSTs the browser first sends an extra `OPTIONS` **preflight** request to ask permission.
- **Cookies:** small values the server asks the browser to store, via a `Set-Cookie` header. The browser then
  attaches them **automatically** to matching requests. This is what our server actually sent after login:
  ```
  set-cookie: refresh_token=XKAe…OZk; HttpOnly; Max-Age=604800; Path=/api/auth; SameSite=strict
  ```
  | Attribute | Meaning |
  |---|---|
  | `HttpOnly` | JavaScript (`document.cookie`) can't read it |
  | `Max-Age=604800` | Expires in 7 days (604,800 seconds) |
  | `Path=/api/auth` | Only sent to URLs under `/api/auth`, not with every request |
  | `SameSite=Strict` | Never sent when the request is started by *another site* |
  | `Secure` (production) | Only sent over HTTPS |
- **Site vs origin:** *site* is the registrable domain (`example.com`). `app.example.com` and `api.example.com`
  are the same **site** but different **origins**. CORS is about origins; SameSite is about sites.
- **Two attacks these rules defend against:**
  - **XSS (cross-site scripting):** an attacker gets *their* JavaScript to run inside *our* page, for example
    through user input shown without escaping. It can then read anything JavaScript can read, such as
    `localStorage`. Defences: Angular escapes `{{ }}` output by default; the refresh token is `HttpOnly`, so
    script can't steal it; the access token lives only in memory and expires in 15 min.
  - **CSRF (cross-site request forgery):** a page on `evil.com` makes *your* browser send a request to our API,
    and the browser would attach your cookies. Defence: `SameSite=Strict`, so the cookie never goes along
    with requests started by another site.

**Example from our code.**
- The cookie flags: [auth.py:L66-L75](../../backend/app/routers/auth.py#L66-L75).
- **Same origin by proxy:** the browser only ever talks to `:4200`. In production nginx forwards `/api` to the
  backend ([nginx.conf:L25-L33](../../frontend/nginx.conf#L25-L33)); with `npm start` the Angular dev server does the same
  ([proxy.conf.json](../../frontend/proxy.conf.json)). Same origin means no CORS headers, no preflights, and no
  cross-origin cookie rules.

**Why we chose it.** Alternatives: call `localhost:8000` directly with CORS + `withCredentials` (more
configuration, an extra preflight on every JSON POST), or keep tokens in `localStorage` (any XSS can steal them).

**How it helps.** The long-lived secret (refresh token) can't be read by any script, can't be used by other sites,
and isn't even sent with normal API calls.

**At large scale.**
- **API on its own domain** (`api.example.com`): you'd need CORS with an explicit allowed origin and
  credentials. If the API were on a *different site*, cookies would need `SameSite=None; Secure` plus CSRF tokens.
- **Static files on a CDN domain** are fine: they need no cookies.
- **Many backend servers:** because our access token is self-contained (a JWT, Module 4) and the refresh cookie
  is checked against a shared database, any server can handle any request. No "sticky sessions" are needed.
- Every cookie is extra bytes on each matching request, which is another reason to scope it with `Path`.

**Interview angle.**
- *"Is CORS a server-side security feature?"* No. It's a **browser** rule about reading responses; `curl` ignores
  it. Real protection is authentication on the server.
- *"XSS vs CSRF, and the defence for each?"* XSS → escape output, CSP, HttpOnly cookies. CSRF → SameSite cookies
  and/or CSRF tokens.
- *"Why not store the JWT in localStorage?"* Any XSS can read it and send it anywhere; an `HttpOnly` cookie
  can't be read by script.

---

### 0.6 JSON and REST APIs

**What it is.** **JSON** is text written like a JavaScript object, which is how the browser and server exchange
data. **REST** is a convention for designing an API: URLs name *things* (resources) and HTTP methods say *what
to do* with them. Like a library: the shelf label is the URL, and "borrow / return / look up" are the methods.

**How it works.**

| Method | Meaning | Safe (no changes)? | Idempotent (repeat = same result)? |
|---|---|---|---|
| GET | read | yes | yes |
| POST | create / perform an action | no | **no** (two POSTs can create two things) |
| PUT | replace | no | yes |
| PATCH | partly update | no | not necessarily |
| DELETE | remove | no | yes |

**Stateless:** every request carries everything needed to handle it (our `Authorization: Bearer …` header). The
server keeps no memory of earlier requests, so *any* server instance can answer *any* request.

**Example from our code.**

| Endpoint | Purpose | Success |
|---|---|---|
| `POST /api/auth/register` | create an account | 201 `{"id", "email"}` |
| `POST /api/auth/login` | start a session | 200 `{"access_token", "expires_in", "user"}` + `Set-Cookie` |
| `POST /api/auth/google` | start a session with Google | 200, same as login |
| `POST /api/auth/refresh` | new access token from the cookie | 200 |
| `POST /api/auth/logout` | end the session | 204 |
| `GET /api/auth/me` | who am I? | 200 |
| `GET /api/auth/config` | is Google login on? | 200 |
| `GET /api/portfolio` | my holdings (protected) | 200 |
| `GET /api/health` | backend status counters | 200 |

- **Validation:** the request body must match a Pydantic model ([auth.py:L41-L42](../../backend/app/routers/auth.py#L41-L42)).
  Otherwise FastAPI answers **422** with details, before our code even runs.
- **JSON over the WebSocket too:** each tick is a JSON message ([broker.py:L22](../../backend/app/realtime/broker.py#L22)).
- **Honest note:** `/login`, `/refresh` and `/logout` are verbs (RPC style), which is common for auth.
  "Pure" REST would be `POST /sessions` and `DELETE /sessions/current`.

**Why we chose it.** JSON is native to JavaScript (`JSON.parse`), human-readable in DevTools, and handled
automatically by both FastAPI and Angular's `HttpClient`.

**How it helps.** Predictable URLs and status codes mean the frontend can react the same way everywhere (e.g.
the interceptor treats *any* 401 as "refresh and retry").

**At large scale.**
- **JSON is wordy.** One tick message is about 90 bytes. At 5 million messages per second (the 1M-user scenario)
  that's ~450 MB/s of traffic. Remedies: send only changed fields, batch several ticks per message, use a binary
  format (MessagePack, Protobuf), and compress.
- **Versioning** (`/api/v1/...`) so old app versions keep working while the API changes.
- **Pagination** for lists, **rate limiting** per user/IP, **HTTP caching** (`Cache-Control`, `ETag`) for GETs
  that rarely change.
- **Idempotency keys** for POSTs that must not happen twice (payments, orders).

**Interview angle.**
- *"PUT vs PATCH vs POST?"* Replace vs partial update vs create/action. PUT is idempotent; POST is not.
- *"Why does statelessness matter for scaling?"* A load balancer can send each request to any server, so you
  scale by adding servers.
- *"REST vs GraphQL vs gRPC in one line each?"* REST: resources + HTTP verbs, simple and cacheable. GraphQL: the
  client asks for exactly the fields it needs in one request. gRPC: fast binary calls between services, common
  internally.
