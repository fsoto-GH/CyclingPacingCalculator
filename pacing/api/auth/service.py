"""
Google OAuth 2.0 exchange + JWT issuance.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from jose import jwt
from sqlalchemy.orm import Session

from pacing.api.config import settings
from pacing.api.models.user import User

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _google_oauth_redirect_uri() -> str:
    """The redirect URI that must match what's registered in Google Cloud Console."""
    return f"{settings.frontend_url}/v1/auth/google/callback"


def google_auth_url() -> str:
    """Build the Google OAuth 2.0 consent-page URL."""
    if not settings.google_client_id:
        raise ValueError("GOOGLE_CLIENT_ID is not configured")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _google_oauth_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"https://accounts.google.com/o/oauth2/v2/auth?{qs}"


async def exchange_google_code(code: str, db: Session) -> str:
    """
    Exchange an authorization code for a Google access token, fetch the
    user's profile, upsert the User row, and return a signed JWT.
    """
    if not settings.google_client_id or not settings.google_client_secret:
        raise ValueError("Google OAuth credentials are not configured")

    async with httpx.AsyncClient(timeout=10) as client:
        # Exchange code for tokens
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": _google_oauth_redirect_uri(),
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()
        google_access_token = tokens["access_token"]

        # Fetch user profile
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )
        userinfo_resp.raise_for_status()
        info = userinfo_resp.json()

    google_id: str = info["sub"]
    email: str = info.get("email", "")
    name: str = info.get("name", email)
    avatar_url: Optional[str] = info.get("picture")

    # Upsert user
    user = db.query(User).filter(User.google_id == google_id).first()
    if user is None:
        user = User(
            google_id=google_id,
            email=email,
            name=name,
            avatar_url=avatar_url,
        )
        db.add(user)
    else:
        user.email = email
        user.name = name
        user.avatar_url = avatar_url
    db.commit()
    db.refresh(user)

    return _issue_jwt(user.id)


def _issue_jwt(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(seconds=settings.jwt_expires_seconds),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
