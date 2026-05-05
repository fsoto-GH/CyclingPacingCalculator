"""
Application settings loaded from environment variables.
All values have sensible defaults so the app works in dev without a .env file.
"""
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "sqlite:///./cycling_pacing.db"

    # ── Auth ──────────────────────────────────────────────────────────────────
    # A strong random string used to sign JWTs.  Generate with:
    #   python -c "import secrets; print(secrets.token_hex(32))"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    # Access token lifetime in seconds (default: 30 days)
    jwt_expires_seconds: int = 60 * 60 * 24 * 30

    # Google OAuth 2.0 credentials
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None

    # Where Google redirects after consent (must match what's configured in
    # Google Cloud Console → OAuth 2.0 credentials → Authorized redirect URIs)
    frontend_url: str = "http://localhost:5173"

    # ── Paid / premium API keys (all optional) ────────────────────────────────
    # Google Places API for higher-quality nearby-stop data.
    google_places_api_key: Optional[str] = None

    # RideWithGPS API key for route search and GPX import.
    ridewithgps_api_key: Optional[str] = None

    # RideWithGPS OAuth 2.0 credentials.
    # Create an API client at https://ridewithgps.com/settings/developers and
    # register a Redirect URI of <backend-base-url>/v1/cycling/rwgps/oauth/callback.
    ridewithgps_client_id: Optional[str] = None
    ridewithgps_client_secret: Optional[str] = None

    # Weather API key placeholder — provider TBD (OpenWeatherMap / Google Weather).
    weather_api_key: Optional[str] = None

    # Cookie security
    cookie_secure: bool = False   # set True in production (HTTPS)
    cookie_samesite: str = "lax"


settings = Settings()
