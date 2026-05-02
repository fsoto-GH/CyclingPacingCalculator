"""
JWT-based authentication dependencies for FastAPI route handlers.

Access tokens are stored in an httpOnly cookie named ``access_token``.
Using httpOnly cookies prevents JavaScript from reading the token, which
mitigates XSS-based token theft.
"""
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from pacing.api.config import settings
from pacing.api.database import get_db
from pacing.api.models.user import User


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def get_current_user(
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Require an authenticated user; raise 401 otherwise."""
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    payload = _decode_token(access_token)
    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


def get_optional_user(
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Return the authenticated user or None if no valid token is present."""
    if not access_token:
        return None
    try:
        payload = _decode_token(access_token)
        user_id: str | None = payload.get("sub")
        if not user_id:
            return None
        return db.query(User).filter(User.id == user_id).first()
    except HTTPException:
        return None
