"""
RideWithGPS OAuth 2.0 popup flow.

GET /v1/cycling/rwgps/oauth/start?state=<opener-origin>
    Redirect the popup window to the RideWithGPS consent page.

GET /v1/cycling/rwgps/oauth/callback?code=...&state=<opener-origin>
    Exchange the code for an access_token, then return a tiny HTML page
    that posts the token back to the opener window and closes the popup.

The frontend opens /start in a popup, listens for window.postMessage, and
stores the returned token in localStorage.  Subsequent search/route requests
send the token via the X-RWGPS-Token header so the backend can authenticate
with Bearer auth instead of the shared API key.
"""
import json
import urllib.parse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse

from pacing.api.auth.deps import _decode_token
from pacing.api.config import settings

router = APIRouter(prefix="/v1/cycling/rwgps/oauth", tags=["rwgps-oauth"])

RWGPS_BASE = "https://ridewithgps.com"

# Origins we will accept as a postMessage target from the state parameter.
# Expanded at runtime with settings.frontend_url.
_HARDCODED_ALLOWED: set[str] = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
}


def _callback_url(request: Request) -> str:
    """Absolute URL of this backend's OAuth callback endpoint."""
    return str(request.base_url).rstrip("/") + "/v1/cycling/rwgps/oauth/callback"


def _safe_opener_origin(state: str, request: Request) -> str:
    """
    Return *state* only if it is a known allowed origin; otherwise fall back
    to the backend's own origin so the postMessage is still sent somewhere
    (even if the opener doesn't receive it, this prevents open-redirect abuse).
    """
    allowed = _HARDCODED_ALLOWED | {settings.frontend_url}
    if state and state in allowed:
        return state
    return str(request.base_url).rstrip("/")


@router.get("/start")
async def oauth_start(
    request: Request,
    state: str = Query(
        "",
        description="The opener window's origin (window.location.origin). "
        "Passed through the OAuth flow and used as the postMessage targetOrigin.",
    ),
    access_token: str = Query(
        "",
        description="Optional Supabase access token. Popup navigations cannot send "
        "headers so the token is passed as a query parameter and verified server-side. "
        "When omitted the OAuth flow proceeds unauthenticated (suitable for local/self-hosted use).",
    ),
):
    """Redirect the popup to the RideWithGPS OAuth consent page."""
    # Validate the Supabase token only when one is actually supplied.
    # Self-hosted / local users who haven't configured Supabase can still
    # connect their RideWithGPS account without being signed in.
    if access_token:
        try:
            _decode_token(access_token)
        except HTTPException:
            raise
    if not settings.ridewithgps_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RIDEWITHGPS_CLIENT_ID is not configured on this server.",
        )

    qs = urllib.parse.urlencode(
        {
            "client_id": settings.ridewithgps_client_id,
            "redirect_uri": _callback_url(request),
            "response_type": "code",
            "state": state,
        }
    )
    return RedirectResponse(url=f"{RWGPS_BASE}/oauth/authorize?{qs}")


@router.get("/callback")
async def oauth_callback(
    request: Request,
    code: str = Query(..., description="Authorization code returned by RideWithGPS."),
    state: str = Query("", description="Opener origin echoed back from /start."),
):
    """
    Exchange the authorization code for an access_token, then serve a tiny
    HTML page that posts the token to the opener and closes the popup window.
    """
    if not settings.ridewithgps_client_id or not settings.ridewithgps_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RideWithGPS OAuth credentials are not configured on this server.",
        )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{RWGPS_BASE}/oauth/token.json",
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.ridewithgps_client_id,
                    "client_secret": settings.ridewithgps_client_secret,
                    "redirect_uri": _callback_url(request),
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RideWithGPS token exchange failed: {exc.response.status_code}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RideWithGPS token exchange error: {exc}",
        )

    access_token: str = data.get("access_token", "")
    user_id: int = data.get("user_id", 0)

    opener_origin = _safe_opener_origin(state, request)

    # Return a self-closing HTML page that posts the token to the opener.
    payload_js = json.dumps(
        {"type": "rwgps-token", "token": access_token, "userId": user_id}
    )
    target_js = json.dumps(opener_origin)

    html = f"""<!DOCTYPE html>
<html>
<head><title>Authorizing…</title></head>
<body>
<p>Authorization complete — you may close this window.</p>
<script>
(function () {{
  try {{
    if (window.opener) {{
      window.opener.postMessage({payload_js}, {target_js});
    }}
  }} catch (e) {{
    console.error('rwgps-oauth postMessage failed:', e);
  }}
  window.close();
}})();
</script>
</body>
</html>"""

    return HTMLResponse(content=html)
