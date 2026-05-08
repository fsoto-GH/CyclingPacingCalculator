"""
JWT-based authentication dependencies for FastAPI route handlers.

Access tokens are Supabase-issued JWTs passed as Bearer tokens in the
Authorization header.  The backend verifies the signature using the
project's JWT secret (Settings → API → JWT Secret in the Supabase dashboard)
and extracts user identity from claims — no database round-trip for auth.

A secondary DB lookup on user_flags is performed to populate feature flags
(e.g. enable_google_places) for the authenticated user.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from pacing.api.config import settings
from pacing.api.database import get_db
from pacing.api.models.user_flags import UserFlags

_bearer = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: Optional[str] = None
    enable_google_places: bool = False


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"verify_aud": False},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def _build_user(payload: dict, flags: Optional[UserFlags]) -> CurrentUser:
    meta = payload.get("user_metadata") or {}
    return CurrentUser(
        id=payload["sub"],
        email=payload.get("email", ""),
        name=meta.get("full_name") or meta.get("name") or payload.get("email", ""),
        avatar_url=meta.get("avatar_url"),
        enable_google_places=flags.enable_google_places if flags else False,
    )


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
