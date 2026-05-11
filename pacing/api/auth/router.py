"""
Authentication routes:
  GET  /v1/auth/google           → redirect to Google OAuth consent page
  GET  /v1/auth/google/callback  → exchange code, set httpOnly cookie, redirect to app
  GET  /v1/auth/me               → return current user info (requires auth)
  POST /v1/auth/logout           → clear the auth cookie
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from pacing.api.auth.deps import get_current_user
from pacing.api.auth.service import exchange_google_code, google_auth_url
from pacing.api.config import settings
from pacing.api.database import get_db
from pacing.api.models.user import User

router = APIRouter(prefix="/v1/auth", tags=["auth"])

_COOKIE_NAME = "access_token"
_COOKIE_MAX_AGE = settings.jwt_expires_seconds


@router.get("/google")
async def google_login():
    """Redirect the browser to Google's OAuth 2.0 consent page."""
    try:
        url = google_auth_url()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    return RedirectResponse(url=url)


@router.get("/google/callback")
async def google_callback(
    code: str,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Google redirects here with ?code=...
    Exchange the code for a JWT, set it in an httpOnly cookie, then redirect
    the browser back to the SPA.
    """
    try:
        token = await exchange_google_code(code, db)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OAuth exchange failed: {exc}",
        )

    redirect = RedirectResponse(url=settings.frontend_url, status_code=302)
    redirect.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        max_age=_COOKIE_MAX_AGE,
        samesite=settings.cookie_samesite,
        secure=settings.cookie_secure,
        path="/",
    )
    return redirect


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    return current_user.to_dict()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(
        key=_COOKIE_NAME,
        path="/",
        samesite=settings.cookie_samesite,
        secure=settings.cookie_secure,
    )
