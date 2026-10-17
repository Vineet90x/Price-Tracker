"""All settings come from environment variables (12-factor style), with dev-friendly defaults."""

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Settings:
    # Signs access tokens. Real value comes from .env via docker compose; this default is for bare local runs only.
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-change-me")
    access_token_seconds: int = int(os.getenv("ACCESS_TOKEN_SECONDS", "900"))  # 15 min
    refresh_token_days: int = int(os.getenv("REFRESH_TOKEN_DAYS", "7"))

    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # True behind HTTPS. Browsers drop Secure cookies on plain http://localhost.
    cookie_secure: bool = _bool("COOKIE_SECURE", False)

    # Public OAuth client ID ("Web application") from Google Cloud Console. Empty = Google login hidden.
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")

    enable_binance: bool = _bool("ENABLE_BINANCE", True)
    binance_ws_url: str = os.getenv("BINANCE_WS_URL", "wss://stream.binance.com:9443/stream")


settings = Settings()
