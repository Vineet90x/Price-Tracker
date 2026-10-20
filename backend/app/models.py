from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    # Naive UTC: SQLite stores no timezone, so aware datetimes would come back naive and fail comparisons.
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    # None for accounts created through Google (they have no password)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # Google's stable user id ("sub" claim). Emails can change; sub never does.
    google_sub: Mapped[Optional[str]] = mapped_column(String(255), unique=True, index=True, default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthSession(Base):
    """One login. Holds the *hash* of the refresh token, never the token itself."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[Optional[datetime]] = mapped_column(default=None)

    def is_valid(self) -> bool:
        return self.revoked_at is None and self.expires_at > utcnow()


class PriceAlert(Base):
    """A user's price alert. Lives on the server, so it fires even when no browser tab is open."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    direction: Mapped[str] = mapped_column(String(5))  # "above" | "below"
    target_price: Mapped[float]
    status: Mapped[str] = mapped_column(String(10), default="active", index=True)  # active | triggered | cancelled
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    triggered_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    triggered_price: Mapped[Optional[float]] = mapped_column(default=None)
