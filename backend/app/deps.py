"""Reusable FastAPI dependencies."""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import SessionLocal, get_db
from .models import AuthSession, User
from .security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=code,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Valid access token AND its session still active. The session lookup costs one indexed
    DB read per request; in exchange, logging in elsewhere revokes old tokens instantly."""
    if creds is None:
        raise _unauthorized("not_authenticated")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("token_expired")
    except jwt.InvalidTokenError:
        raise _unauthorized("invalid_token")

    session = db.get(AuthSession, payload["sid"])
    if session is None or not session.is_valid() or str(session.user_id) != payload["sub"]:
        raise _unauthorized("session_revoked")
    user = db.get(User, session.user_id)
    if user is None:
        raise _unauthorized("invalid_token")
    return user


def user_id_from_token(token: str) -> int | None:
    """Same checks as get_current_user, for the WebSocket (which has no request headers we use).
    Returns the user id, or None if the token is invalid, expired or its session was revoked."""
    try:
        payload = decode_access_token(token)
    except jwt.InvalidTokenError:
        return None
    with SessionLocal() as db:
        session = db.get(AuthSession, payload["sid"])
        if session is None or not session.is_valid() or str(session.user_id) != payload["sub"]:
            return None
        return session.user_id
