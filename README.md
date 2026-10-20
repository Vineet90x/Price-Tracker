# PriceTracker

[![CI](https://github.com/Vineet90x/Price-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Vineet90x/Price-Tracker/actions/workflows/ci.yml)

Live price tracker: Angular 22 (zoneless, signals) + FastAPI + Redis pub-sub, real crypto prices from Binance,
email/password and Google login.

**Start learning here: [docs/LEARNING_PATH.md](docs/LEARNING_PATH.md)** · Architecture: [docs/PROJECT_ARCHITECTURE_GUIDE.md](docs/PROJECT_ARCHITECTURE_GUIDE.md) ·
Angular concepts: [docs/ANGULAR_FRAMEWORK_GUIDE.md](docs/ANGULAR_FRAMEWORK_GUIDE.md) · Rules for AI agents: [AGENTS.md](AGENTS.md)

## Repository layout

```
Price-Tracker/
├── frontend/            Angular app
│   ├── src/             application code (core/, features/, …)
│   ├── Dockerfile       build → nginx image
│   ├── nginx.conf       static files + /api reverse proxy (production)
│   └── proxy.conf.json  /api proxy for `npm start` (development)
├── backend/             FastAPI app (auth, WebSocket, Binance + simulated feeds, Redis)
│   ├── app/
│   └── Dockerfile
├── docs/                guides, learning path (docs/learning/), original build guide
├── tools/               check_doc_links.py
├── .env.example         every environment variable, explained (copy to .env, which is git-ignored)
└── docker-compose.yml   redis + backend + frontend, wired together
```

## Quick start

```bash
# Whole stack (repo root). First time only: create your env file and fill in JWT_SECRET etc.
cp .env.example .env
docker compose up -d --build        # http://localhost:4200  (nginx → FastAPI → Redis → Binance)

# Frontend development with hot reload (backend running via docker compose)
cd frontend
npm ci && npm start                 # http://localhost:4200, /api proxied to the backend on :8000
npx ng test --watch=false           # unit tests
```

No backend? Open `http://localhost:4200/watchlist?feed=sim` for in-browser simulated prices.
Frontend-specific Angular CLI notes: [frontend/README.md](frontend/README.md).
