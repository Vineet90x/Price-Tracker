"""Password hashing, access-token JWTs, and opaque refresh tokens."""

import hashlib
import secrets
import time

import jwt
from jwt import PyJWKClient
from pwdlib import PasswordHash

from .config import settings

# Argon2id: memory-hard, the current OWASP first choice for password storage.
_hasher = PasswordHash.recommended()

# Verifying against this when the email doesn't exist keeps login time the same either way,
# so response timing can't reveal which emails are registered.
_DUMMY_HASH = _hasher.hash("timing-equaliser")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    return _hasher.verify(password, password_hash)


def create_access_token(user_id: int, session_id: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "sid": session_id,  # lets the API reject tokens from a revoked session immediately
        "iat": now,
        "exp": now + settings.access_token_seconds,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises jwt.ExpiredSignatureError / jwt.InvalidTokenError."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub", "sid"]})


# Google publishes the public keys that sign its ID tokens here; they rotate every few days.
# PyJWKClient downloads them once and caches them (refetches when a token names an unknown key id).
_google_keys = PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", cache_keys=True)
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


def verify_google_id_token(token: str) -> dict:
    """Checks a 'Sign in with Google' ID token. Raises jwt.InvalidTokenError (or PyJWKClientError)
    if anything is off:
    - signature: signed by one of Google's current keys (RS256), so nobody else could have made it
    - aud: issued for OUR client ID, so a token made for another website is useless here
    - iss + exp: really from Google, not expired"""
    if not settings.google_client_id:
        raise jwt.InvalidTokenError("Google login is not configured")
    signing_key = _google_keys.get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.google_client_id,
        leeway=120,  # tolerate 2 min clock difference with Google (Docker VM clocks drift after sleep)
        options={"require": ["exp", "iss", "aud", "sub", "email"]},
    )
    if claims["iss"] not in GOOGLE_ISSUERS:
        raise jwt.InvalidIssuerError("not issued by Google")
    return claims


def new_refresh_token() -> str:
    """Opaque random string (not a JWT): it's only ever checked against the DB, so it needs no claims."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 is fine here (unlike passwords): the token is 256 random bits, so it can't be brute-forced."""
    return hashlib.sha256(token.encode()).hexdigest()
