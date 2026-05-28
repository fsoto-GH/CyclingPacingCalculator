"""
POST /v1/cycling/places_search_along_route

Search for places along a cycling route using the Google Places (New) API.
The request supplies a Google Encoded Polyline representing the split route;
the response contains places biased to that route via searchAlongRouteParameters.

Requires enable_google_places = True on the caller's account.
"""
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from pacing.api.auth.deps import CurrentUser, get_google_places_user
from pacing.api.config import settings
from pacing.api.routes.cycling.nearby_stops import (
    NearbyAmenity,
    _haversine_m,  # noqa: F401 (imported for potential future distance calc)
    _parse_google_hours,
)

router = APIRouter(prefix="/v1/cycling", tags=["cycling"])


class SearchAlongRouteRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    encoded_polyline: str = Field(..., min_length=1, max_length=32_000)
    origin_lat: Optional[float] = Field(None, ge=-90, le=90)
    origin_lon: Optional[float] = Field(None, ge=-180, le=180)


async def _query_google_places_along_route(
    query: str,
    encoded_polyline: str,
    origin_lat: Optional[float] = None,
    origin_lon: Optional[float] = None,
) -> list[NearbyAmenity]:
    """
    Call Google Places Text Search (New) API with searchAlongRouteParameters.
    A single API call returns places biased to the supplied encoded polyline.
    https://developers.google.com/maps/documentation/places/web-service/search-along-route
    """
    GOOGLE_TO_OSM: dict[str, str] = {
        "gas_station": "fuel",
        "supermarket": "supermarket",
        "convenience_store": "convenience",
        "pharmacy": "pharmacy",
        "restaurant": "restaurant",
        "food_court": "food_court",
        "cafe": "cafe",
        "meal_takeaway": "fast_food",
        "meal_delivery": "fast_food",
        "ice_cream_shop": "ice_cream",
    }

    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key or "",
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.primaryTypeDisplayName,"
            "places.location,places.formattedAddress,"
            "places.regularOpeningHours,places.types"
        ),
    }
    body: dict = {
        "textQuery": query,
        "searchAlongRouteParameters": {
            "polyline": {
                "encodedPolyline": encoded_polyline,
            }
        },
    }
    if origin_lat is not None and origin_lon is not None:
        print(f"Using origin for searchAlongRouteParameters: {origin_lat}, {origin_lon}")
        body["routingParameters"] = {
            "origin": {
                "latitude": origin_lat,
                "longitude": origin_lon,
            }
        }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=body, headers=headers)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"Google Places Search Along Route HTTP "
                f"{exc.response.status_code}: {exc.response.text}"
            )
        data = resp.json()

    results: list[NearbyAmenity] = []
    for place in data.get("places", []):
        loc = place.get("location", {})
        p_lat = loc.get("latitude", 0.0)
        p_lon = loc.get("longitude", 0.0)
        name = (place.get("displayName") or {}).get("text", "")
        address = place.get("formattedAddress", "")
        g_types: list[str] = place.get("types", [])
        amenity = next(
            (GOOGLE_TO_OSM[t] for t in g_types if t in GOOGLE_TO_OSM), ""
        )
        place_id_str: str = place.get("id", "")
        fake_id = abs(hash(place_id_str)) % (10**9)
        oh = place.get("regularOpeningHours")
        hours = _parse_google_hours(oh) if oh else None
        raw_descriptions: list[str] = (oh or {}).get("weekdayDescriptions", [])
        raw_hours = "; ".join(raw_descriptions) if raw_descriptions else None

        results.append(
            NearbyAmenity(
                id=fake_id,
                name=name,
                amenity=amenity,
                distance_m=0,
                lat=p_lat,
                lon=p_lon,
                address=address,
                street_line="",
                has_locality=bool(address),
                hours=hours,
                raw_hours=raw_hours,
                place_id=place_id_str or None,
            )
        )
    return results


@router.post("/places_search_along_route", response_model=list[NearbyAmenity])
async def places_search_along_route(
    body: SearchAlongRouteRequest,
    current_user: CurrentUser = Depends(get_google_places_user),
):
    """
    Search for places along a cycling route using Google Places (New) API.

    Pass a Google Encoded Polyline representing the split route in the
    ``encoded_polyline`` field.  Results are biased to be near the route with
    minimal detour from origin to destination.  Google returns up to 20 results.

    Requires ``enable_google_places = True`` on the caller's account.
    """
    if not settings.google_places_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Places is not configured on this server.",
        )
    try:
        return await _query_google_places_along_route(
            body.query,
            body.encoded_polyline,
            origin_lat=body.origin_lat,
            origin_lon=body.origin_lon,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Places search along route failed: {exc}",
        )
