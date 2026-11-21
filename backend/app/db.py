"""SQLAlchemy setup. SQLite locally (zero setup); Postgres (e.g. Neon) in production, where the
container's disk is wiped on every restart. Picked by DATABASE_URL."""

import os
from collections.abc import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


def _normalize(url: str) -> str:
    """Neon/Heroku-style URLs say postgres:// or postgresql://, which SQLAlchemy maps to psycopg2.
    We install psycopg 3, so point them at that driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


database_url = _normalize(settings.database_url)
is_sqlite = database_url.startswith("sqlite")

if database_url.startswith("sqlite:///"):
    db_path = database_url.removeprefix("sqlite:///")
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

engine = create_engine(
    database_url,
    # SQLite connections are single-thread by default; FastAPI runs sync endpoints in a thread pool.
    connect_args={"check_same_thread": False} if is_sqlite else {},
    # Hosted Postgres (Neon free tier) suspends when idle and drops open connections:
    # test each pooled connection before use, and replace connections older than 5 minutes.
    pool_pre_ping=not is_sqlite,
    pool_recycle=300 if not is_sqlite else -1,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def migrate() -> None:
    """Tiny hand-written migration (the kind Alembic generates): Google login needs
    users.password_hash to allow NULL and a new users.google_sub column.
    SQLite can't drop NOT NULL in place, so the table is rebuilt and the rows copied.
    Only old SQLite files need it: a Postgres database is always created with the new schema."""
    if not is_sqlite:
        return
    if "users" not in inspect(engine).get_table_names():
        return  # fresh database: create_all() builds the new schema directly
    if "google_sub" in {c["name"] for c in inspect(engine).get_columns("users")}:
        return  # already migrated
    with engine.begin() as conn:  # one transaction: all or nothing
        conn.execute(text(
            "CREATE TABLE users_new ("
            " id INTEGER NOT NULL PRIMARY KEY,"
            " email VARCHAR(255) NOT NULL,"
            " password_hash VARCHAR(255),"
            " google_sub VARCHAR(255),"
            " created_at DATETIME NOT NULL)"
        ))
        conn.execute(text(
            "INSERT INTO users_new (id, email, password_hash, created_at) "
            "SELECT id, email, password_hash, created_at FROM users"
        ))
        conn.execute(text("DROP TABLE users"))
        conn.execute(text("ALTER TABLE users_new RENAME TO users"))
        conn.execute(text("CREATE UNIQUE INDEX ix_users_email ON users (email)"))
        conn.execute(text("CREATE UNIQUE INDEX ix_users_google_sub ON users (google_sub)"))


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
