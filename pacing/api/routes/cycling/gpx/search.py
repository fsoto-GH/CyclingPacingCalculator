"""
GET /v1/cycling/gpx/search?q=&offset=&limit=

Search RideWithGPS routes by keyword.
Requires RIDEWITHGPS_API_KEY to be set; returns 503 otherwise.
"""
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from pacing.api.config import settings

router = APIRouter(prefix="/v1/cycling/gpx", tags=["cycling-gpx"])

RWGPS_BASE = "https://ridewithgps.com"


class RouteSearchResult(BaseModel):
    id: int
    name: str
    distance_m: float
    description: Optional[str] = None
    locality: Optional[str] = None
    user_name: Optional[str] = None
    preview_photo_url: Optional[str] = None


@router.get("/search", response_model=list[RouteSearchResult])
async def gpx_search(
    q: str = Query(..., min_length=1),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """Search RideWithGPS routes by keyword."""
    if not settings.ridewithgps_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RideWithGPS API key is not configured",
        )

    params = {
        "keywords": q,
        "offset": offset,
        "limit": limit,
        "apikey": settings.ridewithgps_api_key,
        "version": "2",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{RWGPS_BASE}/find/routes.json", params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RideWithGPS error: {exc.response.status_code}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GPX search failed: {exc}",
        )

    results: list[RouteSearchResult] = []
    for route in data.get("results", []):
        user = route.get("user") or {}
        results.append(RouteSearchResult(
            id=route["id"],
            name=route.get("name", ""),
            distance_m=float(route.get("distance", 0)),
            description=route.get("description"),
            locality=route.get("locality"),
            user_name=user.get("name"),
            preview_photo_url=route.get("highlight_photo_url"),
        ))
    return results
