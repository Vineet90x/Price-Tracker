# Deploying Price Tracker (free tier)

The two parts of the app go to two different free hosts:

| Part | Where | Plan |
|---|---|---|
| **Frontend** (Angular, `frontend/`) | **Vercel** | Hobby (free) |
| **Backend** (FastAPI, `backend/`) | **Render** Web Service | Free |
| **Redis** | **Render** Key Value | Free |

No credit card is needed for any of these.

```
Browser ──► Vercel (Angular)  ──/api/* rewrite──►  Render (FastAPI) ──► Render Redis
   └────────── WebSocket wss://…/api/ws/prices ──────────►┘
```

The browser calls `/api/...` on the Vercel domain, and Vercel forwards it to Render. The
refresh-token cookie stays on your own domain, so login works with no CORS setup.
Vercel can't forward WebSockets, so the live-price socket connects to Render directly.

### Free-tier limits (fine for a portfolio demo)

- **The backend sleeps after 15 minutes with no visitors.** The next visit takes **~30-60 seconds**
  to wake it up. Prices start streaming once it's awake. (Optional fix: see *Keep it awake* at the end.)
- **Saved data is temporary.** Users, portfolios and alerts are kept in SQLite inside the container,
  which is wiped whenever the backend restarts, redeploys or wakes from sleep. Visitors just
  register again. Live prices are not affected.

---

## Step 1: Make 3 small changes to the code

Pick a name for the backend service now (Step 2 uses it). This guide uses `price-tracker-api`,
so the backend URL is `https://price-tracker-api.onrender.com`. If Render gives you a
different URL in Step 2, use that one everywhere below.

### 1a. `frontend/vercel.json` (new file)

Sends every `/api/...` request to the backend:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://price-tracker-api.onrender.com/api/:path*"
    }
  ]
}
```

### 1b. `frontend/src/app/core/services/websocket-price-feed.ts`

Point the socket at Render when the app isn't running locally. Find this block in the constructor:

```ts
const { protocol, host } = inject(DOCUMENT).location;
this.socket = webSocket<ServerMessage | ClientMessage>({
  // Same origin as the page: the dev proxy / nginx forwards /api to the backend.
  url: `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/ws/prices`,
```

Change it to:

```ts
const { protocol, host } = inject(DOCUMENT).location;
// Locally the dev proxy / nginx forwards /api (incl. WebSocket) to the backend.
// In production Vercel can't proxy WebSockets, so connect to the backend directly.
const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
const wsUrl = isLocal
  ? `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/ws/prices`
  : 'wss://price-tracker-api.onrender.com/api/ws/prices';
this.socket = webSocket<ServerMessage | ClientMessage>({
  url: wsUrl,
```

### 1c. `frontend/angular.json`: allow the Vercel host for SSR

Under `projects → price-tracker → architect → build → options → security`, change:

```json
"allowedHosts": []
```

to:

```json
"allowedHosts": ["*.vercel.app"]
```

### 1d. Commit and push

```bash
git add frontend/vercel.json frontend/angular.json frontend/src/app/core/services/websocket-price-feed.ts
git commit -m "Add Vercel + Render deployment config"
git push origin main
```

---

## Step 2: Deploy the backend on Render

Create both services by hand from the dashboard. Don't use **Blueprint**: it asks for payment details.

### 2a. Create Redis (Key Value)

1. Go to <https://dashboard.render.com> and sign in with GitHub.
2. Click **New + → Key Value**.
3. Fill in:
   - **Name:** `price-tracker-redis`
   - **Region:** **Singapore** (it must match the backend's region in 2b)
   - **Instance Type:** **Free**
4. Click **Create Key Value**.
5. When it's ready, open it and copy the **Internal Key Value URL** (it looks like `redis://red-xxxx:6379`).

### 2b. Create the backend (Web Service)

1. Click **New + → Web Service**.
2. Connect GitHub if asked, then pick **Vineet90x/Price-Tracker**.
3. Fill in:
   - **Name:** `price-tracker-api`
   - **Language / Runtime:** **Docker**
   - **Branch:** `main`
   - **Region:** **Singapore** (not a US region: Binance blocks US IPs, and you need the same region as Redis)
   - **Root Directory:** `backend`
   - **Dockerfile Path:** `./Dockerfile` (relative to `backend/`, so leave the default if it shows that)
   - **Instance Type:** **Free**
4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `PORT` | `8000` |
   | `REDIS_URL` | the Internal Key Value URL from 2a |
   | `JWT_SECRET` | a long random string (click **Generate** if shown, or run `python -c "import secrets; print(secrets.token_urlsafe(48))"`) |
   | `COOKIE_SECURE` | `true` |
   | `ENABLE_BINANCE` | `true` |
   | `GOOGLE_CLIENT_ID` | your Google client ID (leave this row out to hide Google login) |

5. Under **Advanced**, set **Health Check Path** to `/api/health`.
6. Click **Deploy Web Service** and wait for the log to show `Uvicorn running on http://0.0.0.0:8000`.
7. Open `https://price-tracker-api.onrender.com/api/health`. You should see something like:
   ```json
   {"redis": true, ...}
   ```
   If `redis` is `true`, the backend is ready.

> Check the URL Render shows at the top of the service page. If it isn't exactly
> `price-tracker-api.onrender.com` (for example because the name was taken), update
> `vercel.json` and `websocket-price-feed.ts` with the real URL, then push again.

---

## Step 3: Deploy the frontend on Vercel

1. Open the Vercel import screen for **Vineet90x/Price-Tracker** (the one with "Multiple applications detected").
2. **Do not** use the *Services* preset. Next to **frontend**, click **Import single project →**.
3. Check the settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Angular
   - Build command and output: leave the defaults
   - **Environment Variables:** none needed
4. Click **Deploy**.
5. When it's done you get a URL like `https://price-tracker-xxxx.vercel.app`. Put this link on your resume.

---

## Step 4: Google login (only if you use it)

1. Go to Google Cloud Console → **APIs & Services → Credentials** and open your OAuth client (Web application).
2. Under **Authorized JavaScript origins**, add your Vercel URL, e.g. `https://price-tracker-xxxx.vercel.app`.
3. Save. Changes can take a few minutes to apply.

---

## Step 5: Check that everything works

Open the backend health URL first so it's awake, then open your Vercel URL and check:

- [ ] The page loads.
- [ ] The live-price indicator says **live** and prices move (BTC etc. from Binance, NSE stocks simulated).
- [ ] You can register, log out, and log in again.
- [ ] Refresh the page: you stay logged in.
- [ ] Add a portfolio item and an alert; set an alert close to the current price and see it fire.

---

## Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| First load is slow or shows errors, then works | The backend was asleep. Wait ~1 minute and refresh. |
| `/api/...` calls return 404 on Vercel | `frontend/vercel.json` is missing, or Root Directory isn't `frontend`. |
| `/api/...` calls return 502/504 | The backend is waking up or failed to start. Check Render → `price-tracker-api` → **Logs**. |
| Prices stuck on "reconnecting" | The WebSocket URL in `websocket-price-feed.ts` doesn't match your Render URL, or you didn't push after changing it. |
| Only the NSE stocks move, no crypto | Binance blocked the region. The service must be in **Singapore** or **Frankfurt**, not a US region (you can't change the region later, so recreate the service). |
| `/api/health` shows `"redis": false` | `REDIS_URL` is wrong, or Redis is in a different region. Use the **Internal** URL, with both services in the same region. |
| Logged out after a refresh | `COOKIE_SECURE` must be `true`, and the site must be opened over `https://`. |
| My account disappeared | Expected on the free tier: data resets when the backend restarts or sleeps. |
| Google popup error "origin not allowed" | Add the Vercel URL to the OAuth client's Authorized JavaScript origins (Step 4). |

---

## Optional: Keep it awake

So a recruiter doesn't hit the 1-minute wake-up:

1. Sign up at <https://cron-job.org> (free).
2. Create a job that opens `https://price-tracker-api.onrender.com/api/health` **every 10 minutes**.

Render's free plan gives 750 hours/month, which is enough to keep one service running all month.
Saved data is still wiped on each redeploy.

## Updating later

Push to `main` and both sides redeploy automatically.
