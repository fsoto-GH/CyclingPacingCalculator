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
    # Set IS_LOCAL=true to use DATABASE_URL_LOCAL, false to use DATABASE_URL_SUPABASE.
    # If DATABASE_URL is set directly it always takes precedence (e.g. inside Docker).
    is_local: bool = False
    database_url: str = "sqlite:///./cycling_pacing.db"
    database_url_local: Optional[str] = None
    database_url_supabase: Optional[str] = None

    @property
    def active_database_url(self) -> str:
        """Resolve the database URL based on IS_LOCAL, falling back to DATABASE_URL."""
        if self.is_local and self.database_url_local:
            return self.database_url_local
        elif not self.is_local and self.database_url_supabase:
            return self.database_url_supabase
        return self.database_url

    # ── Auth ──────────────────────────────────────────────────────────────────
    # Supabase project URL — used to fetch JWKS public keys for JWT verification.
    supabase_url: Optional[str] = None

    # Legacy HS256 secret — only needed if the project still uses the old signing mode.
    supabase_jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"

    # Frontend / CORS origin.
    frontend_url: str = "http://localhost:5173"
    # Optional comma-separated list of additional frontend origins.
    # Example:
    # FRONTEND_URLS=https://cyclingpacingcalculator.onrender.com,https://fsoto-gh.github.io
    frontend_urls: Optional[str] = None

    @property
    def allowed_frontend_origins(self) -> list[str]:
        origins = [self.frontend_url]
        if self.frontend_urls:
            extras = [x.strip() for x in self.frontend_urls.split(",") if x.strip()]
            origins.extend(extras)
        # Preserve order while removing duplicates
        return list(dict.fromkeys(origins))

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
