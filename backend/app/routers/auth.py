"""Register / login / refresh / logout / me.

Token model:
- access token: short-lived JWT, returned in the JSON body; the Angular app keeps it in memory only.
- refresh token: long-lived random string in an httpOnly cookie scoped to /api/auth.
  JavaScript can never read it; the browser sends it only to the auth endpoints.
"""

import logging
import uuid
from datetime import timedelta

import jwt

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import AuthSession, User, utcnow
from ..security import (
    create_access_token,
    hash_password,
    hash_token,
    new_refresh_token,
    verify_google_id_token,
    verify_password,
)

log = logging.getLogger("auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"
COOKIE_PATH = "/api/auth"


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)


class GoogleCredential(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)  # the ID token from Google's button


class AuthConfigOut(BaseModel):
    google_client_id: str | None


class UserOut(BaseModel):
    id: int
    email: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_days * 86400,
        httponly=True,  # invisible to JavaScript → XSS can't steal it
        secure=settings.cookie_secure,
        samesite="strict",  # never sent on cross-site requests → CSRF can't use it
        path=COOKIE_PATH,  # sent only to /api/auth/*, not with every API call
    )


def _token_out(user: User, session_id: str) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, session_id),
        expires_in=settings.access_token_seconds,
        user=UserOut(id=user.id, email=user.email),
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=UserOut)
def register(body: Credentials, db: Session = Depends(get_db)) -> UserOut:
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email_taken")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return UserOut(id=user.id, email=user.email)


@router.post("/login", response_model=TokenOut)
def login(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(body.password, user.password_hash if user else None):
        # Same error for "no such user" and "wrong password": don't reveal which emails exist.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_credentials")
    return _start_session(user, request, response, db)


def _start_session(user: User, request: Request, response: Response, db: Session) -> TokenOut:
    """Shared by password and Google login: everything after "we know who you are"."""
    now = utcnow()
    # Single active session per user: a new login revokes every previous one.
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    refresh_token = new_refresh_token()
    session = AuthSession(
        id=uuid.uuid4().hex,
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        user_agent=request.headers.get("user-agent", "")[:255],
        expires_at=now + timedelta(days=settings.refresh_token_days),
    )
    db.add(session)
    db.commit()

    _set_refresh_cookie(response, refresh_token)
    return _token_out(user, session.id)


@router.get("/config", response_model=AuthConfigOut)
def auth_config() -> AuthConfigOut:
    """Tells the frontend whether (and with which public client ID) to show the Google button."""
    return AuthConfigOut(google_client_id=settings.google_client_id or None)


@router.post("/google", response_model=TokenOut)
def google_login(
    body: GoogleCredential, request: Request, response: Response, db: Session = Depends(get_db)
) -> TokenOut:
    """'Sign in with Google': verify Google's ID token, find or create the user, then start a
    normal session (same access token + refresh cookie as a password login)."""
    try:
        claims = verify_google_id_token(body.credential)
    except jwt.PyJWTError as exc:  # bad signature, wrong audience, expired, unknown key, …
        log.info("rejected Google token: %r", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_google_token")
    if not claims.get("email_verified"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "google_email_not_verified")

    google_sub = claims["sub"]
    email = claims["email"].strip().lower()

    user = db.scalar(select(User).where(User.google_sub == google_sub))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, google_sub=google_sub)  # new account, no password
            db.add(user)
        elif user.google_sub is None:
            # Existing password account, same Google-verified email: same person, link them.
            user.google_sub = google_sub
        else:
            # The email already belongs to a DIFFERENT Google account: never merge silently.
            raise HTTPException(status.HTTP_409_CONFLICT, "email_linked_to_other_google_account")
        db.flush()  # gives a new user its id before the session row references it

    return _start_session(user, request, response, db)


@router.post("/refresh", response_model=TokenOut)
def refresh(
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> TokenOut:
    """Trade the refresh cookie for a new access token. The refresh token is NOT rotated
    (see Decision Log: rotation races when two tabs refresh at once)."""
    if not refresh_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "no_refresh_token")
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(refresh_token)))
    if session is None or not session.is_valid():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session_expired")
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session_expired")
    return _token_out(user, session.id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(refresh_token: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> Response:
    if refresh_token:
        db.execute(
            update(AuthSession)
            .where(AuthSession.token_hash == hash_token(refresh_token), AuthSession.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email)
