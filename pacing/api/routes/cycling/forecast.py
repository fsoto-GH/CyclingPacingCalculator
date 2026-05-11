"""
GET /v1/cycling/forecast

Proxy for weather forecasts.  Currently delegates to Open-Meteo
(free, no key required).  When a paid WEATHER_API_KEY is set in settings,
a premium provider branch can be inserted here without changing the frontend.

The endpoint intentionally mirrors the Open-Meteo response shape so the
frontend weather.ts module can call this route instead of hitting Open-Meteo
directly, keeping all API traffic through the backend.

Modes:
  forecast   → api.open-meteo.com            (up to 16 days ahead)
  historical → historical-forecast-api.open-meteo.com  (past dates via ECMWF reanalysis)
"""
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from pacing.api.config import settings

router = APIRouter(prefix="/v1/cycling", tags=["cycling"])

_MINUTELY_15_FIELDS = (
    "temperature_2m,apparent_temperature,precipitation,rain,"
    "weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m"
)

_HOURLY_FIELDS = (
    "precipitation_probability,cloud_cover,is_day,relative_humidity_2m"
)


@router.get("/forecast")
async def forecast(
    lat: str = Query(..., description="Comma-separated latitudes (up to 50)"),
    lon: str = Query(..., description="Comma-separated longitudes (up to 50)"),
    mode: str = Query("forecast", description='"forecast" or "historical"'),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
):
    """
    Proxy weather data from Open-Meteo.
    Returns the raw Open-Meteo JSON so the frontend SplitWeather parsing
    logic does not need to change.
    """
    # Validate lat/lon counts match and are within batch limit
    lats = [v.strip() for v in lat.split(",")]
    lons = [v.strip() for v in lon.split(",")]
    if len(lats) != len(lons):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="lat and lon must have the same number of values",
        )
    if len(lats) > 50:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Maximum 50 locations per request",
        )
    if not start_date or not end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="start_date and end_date are required",
        )

    # --- Future: insert paid-provider branch here when settings.weather_api_key is set ---

    if mode == "historical":
        base_host = "historical-forecast-api.open-meteo.com"
    else:
        base_host = "api.open-meteo.com"

    url = (
        f"https://{base_host}/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&minutely_15={_MINUTELY_15_FIELDS}"
        f"&hourly={_HOURLY_FIELDS}"
        f"&models=best_match"
        f"&start_date={start_date}&end_date={end_date}"
        f"&timeformat=iso8601"
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Weather API error: {exc.response.status_code}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Weather fetch failed: {exc}",
        )
