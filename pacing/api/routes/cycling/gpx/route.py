"""
GET /v1/cycling/gpx/{id}

Fetch a single RideWithGPS route and return its track points in the same
GpxTrackPoint shape used by the frontend gpxParser.ts, along with metadata.
Requires RIDEWITHGPS_API_KEY to be set.
"""
import httpx
from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel
from typing import Optional

from pacing.api.config import settings

router = APIRouter(prefix="/v1/cycling/gpx", tags=["cycling-gpx"])

RWGPS_BASE = "https://ridewithgps.com"


class GpxTrackPoint(BaseModel):
    lat: float
    lon: float
    ele: float       # metres
    cumDist: float   # km from track start


class RouteDetail(BaseModel):
    id: int
    name: str
    distance_m: float
    description: Optional[str] = None
    locality: Optional[str] = None
    track_points: list[GpxTrackPoint]


@router.get("/{route_id}", response_model=RouteDetail)
async def get_gpx_route(
    route_id: int = Path(..., ge=1),
):
    """
    Fetch a RideWithGPS route and convert it to the frontend's GpxTrackPoint format.
    RideWithGPS track_points use: {x: lon, y: lat, e: ele_m, d: cum_dist_m}
    """
    if not settings.ridewithgps_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RideWithGPS API key is not configured",
        )

    params = {"apikey": settings.ridewithgps_api_key, "version": "2"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{RWGPS_BASE}/routes/{route_id}.json", params=params
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Route {route_id} not found",
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RideWithGPS error: {exc.response.status_code}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GPX route fetch failed: {exc}",
        )

    route = data.get("route", data)
    raw_points: list[dict] = route.get("track_points", [])

    track_points: list[GpxTrackPoint] = []
    for pt in raw_points:
        # RideWithGPS: x=lon, y=lat, e=elevation(m), d=cumulative distance (m)
        track_points.append(GpxTrackPoint(
            lat=float(pt.get("y", 0)),
            lon=float(pt.get("x", 0)),
            ele=float(pt.get("e", 0)),
            cumDist=float(pt.get("d", 0)) / 1000.0,
        ))

    return RouteDetail(
        id=route.get("id", route_id),
        name=route.get("name", ""),
        distance_m=float(route.get("distance", 0)),
        description=route.get("description"),
        locality=route.get("locality"),
        track_points=track_points,
    )
