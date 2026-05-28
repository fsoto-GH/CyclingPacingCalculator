"""
GET /v1/maps/google-tile-session

Creates a Google Maps tile session token and returns a complete tile URL
template that Leaflet can use directly.  Requires authentication and the
``enable_google_maps`` feature flag.

Session tokens are created via the Maps Tiles API:
  POST https://tile.googleapis.com/v1/createSession?key=KEY

The returned ``tile_url_template`` embeds both the session token and the API
key so the frontend never needs its own copy of the key.  Restrict the GCP key
to the app's HTTP referrer for security.
"""
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from pacing.api.auth.deps import CurrentUser, get_google_maps_user
from pacing.api.config import settings

router = APIRouter(prefix="/v1/maps", tags=["maps"])

_TILE_BASE = "https://tile.googleapis.com/v1"

MapType = Literal["roadmap", "satellite", "terrain", "dark"]

_DARK_MAP_STYLES = [
    {"elementType": "geometry", "stylers": [{"color": "#212121"}]},
    {"elementType": "labels.icon", "stylers": [{"visibility": "off"}]},
    {"elementType": "labels.text.fill", "stylers": [{"color": "#757575"}]},
    {"elementType": "labels.text.stroke", "stylers": [{"color": "#212121"}]},
    {"featureType": "administrative", "elementType": "geometry", "stylers": [{"color": "#757575"}]},
    {"featureType": "administrative.country", "elementType": "labels.text.fill", "stylers": [{"color": "#9e9e9e"}]},
    {"featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{"color": "#bdbdbd"}]},
    {"featureType": "poi", "elementType": "labels.text.fill", "stylers": [{"color": "#757575"}]},
    {"featureType": "poi.park", "elementType": "geometry", "stylers": [{"color": "#181818"}]},
    {"featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{"color": "#616161"}]},
    {"featureType": "poi.park", "elementType": "labels.text.stroke", "stylers": [{"color": "#1b1b1b"}]},
    {"featureType": "road", "elementType": "geometry.fill", "stylers": [{"color": "#2c2c2c"}]},
    {"featureType": "road", "elementType": "labels.text.fill", "stylers": [{"color": "#8a8a8a"}]},
    {"featureType": "road.arterial", "elementType": "geometry", "stylers": [{"color": "#373737"}]},
    {"featureType": "road.highway", "elementType": "geometry", "stylers": [{"color": "#3c3c3c"}]},
    {"featureType": "road.highway.controlled_access", "elementType": "geometry", "stylers": [{"color": "#4e4e4e"}]},
    {"featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{"color": "#616161"}]},
    {"featureType": "transit", "elementType": "labels.text.fill", "stylers": [{"color": "#757575"}]},
    {"featureType": "water", "elementType": "geometry", "stylers": [{"color": "#000000"}]},
    {"featureType": "water", "elementType": "labels.text.fill", "stylers": [{"color": "#3d3d3d"}]},
]


class TileSessionResponse(BaseModel):
    tile_url_template: str
    expiry: int


@router.get("/google-tile-session", response_model=TileSessionResponse)
async def get_google_tile_session(
    map_type: MapType = Query("roadmap", alias="type"),
    current_user: CurrentUser = Depends(get_google_maps_user),
) -> TileSessionResponse:
    """
    Create a Google Maps tile session and return the tile URL template.

    The returned ``tile_url_template`` is a Leaflet-compatible URL with
    ``{z}/{x}/{y}`` placeholders and both the session token and API key
    embedded as query parameters::

        https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=TOKEN&key=KEY
    """
    if not settings.google_places_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Maps API key is not configured on the server.",
        )

    actual_map_type = "roadmap" if map_type == "dark" else map_type
    payload: dict = {
        "mapType": actual_map_type,
        "language": "en-US",
        "region": "US",
    }
    if map_type == "dark":
        payload["styles"] = _DARK_MAP_STYLES
    
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{_TILE_BASE}/createSession",
            params={"key": settings.google_places_api_key},
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to create Google Maps tile session.",
        )
    
    data = resp.json()
    session = data.get("session")
    expiry = int(data.get("expiry", 0))

    if not session:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid response from Google Maps tile session API.",
        )

    key = settings.google_places_api_key
    tile_url_template = (
        f"{_TILE_BASE}/2dtiles/{{z}}/{{x}}/{{y}}"
        f"?session={session}&key={key}"
    )

    return TileSessionResponse(tile_url_template=tile_url_template, expiry=expiry)
