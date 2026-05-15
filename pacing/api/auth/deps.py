"""
JWT-based authentication dependencies for FastAPI route handlers.

Access tokens are Supabase-issued JWTs passed as Bearer tokens in the
Authorization header.

Verification strategy (tried in order):
  1. JWKS  — if SUPABASE_URL is set, fetch public keys from Supabase's
             /.well-known/jwks.json endpoint (supports RS256 / ES256, the
             default for new Supabase projects that use asymmetric signing keys).
  2. HS256 — fall back to the legacy SUPABASE_JWT_SECRET for projects that
             still use the symmetric signing mode.

JWKS keys are cached in-process and refreshed once per hour.
"""
import logging
import threading
import time
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwk, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from pacing.api.config import settings
from pacing.api.database import get_db
from pacing.api.models.user_flags import UserFlags

_bearer = HTTPBearer(auto_error=False)
_log = logging.getLogger(__name__)

# ── JWKS cache ────────────────────────────────────────────────────────────────
_JWKS_TTL = 3600  # seconds
_jwks_lock = threading.Lock()
_jwks_cache: list[dict] = []
_jwks_fetched_at: float = 0.0


def _get_jwks() -> list[dict]:
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache and (now - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_cache
    with _jwks_lock:
        if _jwks_cache and (now - _jwks_fetched_at) < _JWKS_TTL:
            return _jwks_cache
        url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        try:
            resp = httpx.get(url, timeout=5)
            resp.raise_for_status()
            keys = resp.json().get("keys", [])
            _jwks_cache = keys
            _jwks_fetched_at = time.monotonic()
            _log.info("JWKS refreshed: %d key(s) loaded from %s", len(keys), url)
        except Exception as exc:
            _log.warning("Failed to fetch JWKS from %s: %s", url, exc)
        return _jwks_cache


# ── Token decoding ────────────────────────────────────────────────────────────

def _decode_token(token: str) -> dict:
    """
    Verify the token signature and return the decoded claims.
    Tries asymmetric JWKS first; falls back to HS256 secret.
    """
    # ── Try JWKS (new Supabase projects with asymmetric keys) ─────────────────
    if settings.supabase_url:
        try:
            headers = jwt.get_unverified_headers(token)
            kid = headers.get("kid")
            alg = headers.get("alg", "RS256")
            keys = _get_jwks()
            matching = [k for k in keys if k.get("kid") == kid] if kid else keys
            for key_data in matching:
                try:
                    public_key = jwk.construct(key_data)
                    return jwt.decode(
                        token,
                        public_key,
                        algorithms=[alg, "RS256", "ES256"],
                        options={"verify_aud": False},
                    )
                except JWTError:
                    continue
        except Exception as exc:
            _log.debug("JWKS verification attempt failed: %s", exc)

    # ── Fall back to legacy HS256 secret ──────────────────────────────────────
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except JWTError as exc:
        _log.warning("JWT verification failed (all methods): %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ── User building ─────────────────────────────────────────────────────────────

class CurrentUser(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: Optional[str] = None
    enable_google_places: bool = False


def _build_user(payload: dict, flags: Optional[UserFlags]) -> CurrentUser:
    meta = payload.get("user_metadata") or {}
    return CurrentUser(
        id=payload["sub"],
        email=payload.get("email", ""),
        name=meta.get("full_name") or meta.get("name") or payload.get("email", ""),
        avatar_url=meta.get("avatar_url"),
        enable_google_places=flags.enable_google_places if flags else False,
    )


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(_bearer),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """Require an authenticated user; raise 401 otherwise."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    payload = _decode_token(credentials.credentials)
    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    flags = db.query(UserFlags).filter(UserFlags.user_id == user_id).first()
    return _build_user(payload, flags)


def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(_bearer),
    db: Session = Depends(get_db),
) -> Optional[CurrentUser]:
    """Return the authenticated user or None if no valid token is present."""
    if not credentials:
        return None
    try:
        payload = _decode_token(credentials.credentials)
        user_id: str | None = payload.get("sub")
        if not user_id:
            return None
        flags = db.query(UserFlags).filter(UserFlags.user_id == user_id).first()
        return _build_user(payload, flags)
    except HTTPException:
        return None


def get_google_places_user(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Require an authenticated user with enable_google_places = True; raise 403 otherwise."""
    if not current_user.enable_google_places:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google Places access is not enabled for your account.",
        )
    return current_user
