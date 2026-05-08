"""
GET /v1/cycling/nearby_stops

Proxy for nearby-amenity lookups.  Two backends are supported:
  - Google Places Nearby Search  (when GOOGLE_PLACES_API_KEY is set)
  - Overpass API                  (free fallback, same query as the frontend)

Both paths return a normalized NearbyAmenity list so the frontend does not
need to know which backend was used.
"""
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from pacing.api.auth.deps import CurrentUser, get_optional_user
from pacing.api.config import settings

router = APIRouter(prefix="/v1/cycling", tags=["cycling"])

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

DEFAULT_AMENITY_TYPES = [
    "bench", "cafe", "convenience", "fast_food", "food_court",
    "fuel", "supermarket", "ice_cream", "pharmacy", "restaurant",
    "vending_machine", "drinking_water",
]

_VALID_AMENITY_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyz0123456789_"
)


def _sanitize(t: str) -> str:
    return "".join(c for c in t.lower() if c in _VALID_AMENITY_CHARS)


class NearbyAmenity(BaseModel):
    id: int
    name: str
    amenity: str
    distance_m: float
    lat: float
    lon: float
    address: str
    street_line: str
    has_locality: bool
    hours: Optional[dict] = None
    raw_hours: Optional[str] = None


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    R = 6_371_000
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(d_lon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _query_overpass(
    lat: float,
    lon: float,
    radius_m: float,
    types: list[str],
) -> list[NearbyAmenity]:
    type_str = "|".join(types)
    query = (
        f'[out:json][timeout:10][maxsize:1048576];\n'
        f'node(around:{radius_m},{lat},{lon})[amenity~"{type_str}"][name];\n'
        f'out;'
    )
    body = f"data={httpx.QueryParams({'data': query})}"
    # Use a simpler encoding approach
    body = "data=" + httpx.QueryParams(data=query).get("data", "")

    last_err: Exception = Exception("All Overpass endpoints failed")
    async with httpx.AsyncClient(timeout=12) as client:
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                resp = await client.post(
                    endpoint,
                    content=f"data={query}".encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data.get("remark"), str) and "runtime error" in data["remark"]:
                    raise RuntimeError(f"Overpass OOM: {data['remark']}")
                elements = data.get("elements", [])
                results: list[NearbyAmenity] = []
                for el in elements:
                    tags = el.get("tags") or {}
                    if not tags.get("name"):
                        continue
                    el_lat = el.get("lat") or (el.get("center") or {}).get("lat") or lat
                    el_lon = el.get("lon") or (el.get("center") or {}).get("lon") or lon
                    dist = _haversine_m(lat, lon, el_lat, el_lon)

                    house = tags.get("addr:housenumber", "")
                    street = tags.get("addr:street", "")
                    street_line = f"{house} {street}".strip() if house and street else street
                    has_locality = bool(tags.get("addr:city") or tags.get("addr:state"))

                    addr_parts = []
                    if street_line:
                        addr_parts.append(street_line)
                    if tags.get("addr:city"):
                        addr_parts.append(tags["addr:city"])
                    if tags.get("addr:state"):
                        addr_parts.append(tags["addr:state"])

                    results.append(NearbyAmenity(
                        id=el["id"],
                        name=tags["name"],
                        amenity=tags.get("amenity", ""),
                        distance_m=round(dist),
                        lat=el_lat,
                        lon=el_lon,
                        address=", ".join(addr_parts),
                        street_line=street_line,
                        has_locality=has_locality,
                        raw_hours=tags.get("opening_hours"),
                    ))
                results.sort(key=lambda x: x.distance_m)
                return results
            except Exception as exc:
                last_err = exc
    raise last_err


async def _query_google_places(
    lat: float,
    lon: float,
    radius_m: float,
    types: list[str],
) -> list[NearbyAmenity]:
    """
    Call Google Places Nearby Search (New) API.
    Maps OSM amenity types to Google place types as best as possible.
    """
    # OSM amenity -> Google Places (New) place types.
    # Keep this to known, broadly supported types to avoid 400s from invalid
    # legacy type names.
    OSM_TO_GOOGLE_TYPES: dict[str, list[str]] = {
        "fuel": ["gas_station"],
        "supermarket": ["supermarket"],
        "convenience": ["convenience_store"],
        "pharmacy": ["pharmacy"],
        "restaurant": ["restaurant"],
        "food_court": ["food_court"],
        "cafe": ["cafe"],
        "fast_food": ["meal_takeaway"],
        "ice_cream": ["ice_cream_shop"],
    }

    requested = set(types)
    google_types: list[str] = []
    for osm_type in requested:
        google_types.extend(OSM_TO_GOOGLE_TYPES.get(osm_type, []))

    # Deduplicate while preserving order.
    google_types = list(dict.fromkeys(google_types))

    # Fallback default type set if caller passed unknown OSM amenity filters.
    if not google_types:
        google_types = [
            "gas_station",
            "supermarket",
            "convenience_store",
            "pharmacy",
            "restaurant",
            "food_court",
            "cafe",
            "meal_takeaway",
            "ice_cream_shop",
        ]

    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key or "",
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.primaryTypeDisplayName,"
            "places.location,places.formattedAddress,"
            "places.regularOpeningHours,places.types"
        ),
    }
    body = {
        "includedTypes": google_types,
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lon},
                "radius": float(radius_m),
            }
        },
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, json=body, headers=headers)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Bubble up the provider response body so callers can diagnose
            # invalid type names / field masks / project config issues.
            raise RuntimeError(
                f"Google Places HTTP {exc.response.status_code}: {exc.response.text}"
            )
        data = resp.json()

    results: list[NearbyAmenity] = []
    for place in data.get("places", []):
        loc = place.get("location", {})
        p_lat = loc.get("latitude", lat)
        p_lon = loc.get("longitude", lon)
        dist = _haversine_m(lat, lon, p_lat, p_lon)
        name = (place.get("displayName") or {}).get("text", "")
        address = place.get("formattedAddress", "")
        # Derive best-matching OSM amenity type from Google types
        g_types_for_place: list[str] = place.get("types", [])
        amenity = ""
        if "gas_station" in g_types_for_place:
            amenity = "fuel"
        elif "supermarket" in g_types_for_place:
            amenity = "supermarket"
        elif "convenience_store" in g_types_for_place:
            amenity = "convenience"
        elif "pharmacy" in g_types_for_place:
            amenity = "pharmacy"
        elif "restaurant" in g_types_for_place:
            amenity = "restaurant"
        elif "food_court" in g_types_for_place:
            amenity = "food_court"
        elif "cafe" in g_types_for_place:
            amenity = "cafe"
        elif "meal_takeaway" in g_types_for_place:
            amenity = "fast_food"
        elif "ice_cream_shop" in g_types_for_place:
            amenity = "ice_cream"
        # Use a stable int id derived from the place ID string
        place_id_str: str = place.get("id", "")
        fake_id = abs(hash(place_id_str)) % (10 ** 9)

        results.append(NearbyAmenity(
            id=fake_id,
            name=name,
            amenity=amenity,
            distance_m=round(dist),
            lat=p_lat,
            lon=p_lon,
            address=address,
            street_line="",
            has_locality=bool(address),
        ))
    results.sort(key=lambda x: x.distance_m)
    return results


@router.get("/nearby_stops", response_model=list[NearbyAmenity])
async def nearby_stops(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(1610, ge=50, le=50_000),
    amenity_filter: Optional[str] = Query(
        None,
        description="Comma-separated OSM amenity types to include",
    ),
    current_user: Optional[CurrentUser] = Depends(get_optional_user),
):
    """
    Return nearby amenities for the given coordinates.
    Uses Google Places when GOOGLE_PLACES_API_KEY is configured and the caller
    has enable_google_places = True; falls back to Overpass (open, no auth).
    """
    types: list[str] = (
        [_sanitize(t) for t in amenity_filter.split(",") if _sanitize(t)]
        if amenity_filter
        else DEFAULT_AMENITY_TYPES[:]
    )

    use_google = (
        bool(settings.google_places_api_key)
        and current_user is not None
        and current_user.enable_google_places
    )

    if use_google:
        try:
            return await _query_google_places(lat, lon, radius_m, types)
        except Exception as google_exc:
            # Fail open to Overpass so nearby-stops still works on Google errors.
            try:
                return await _query_overpass(lat, lon, radius_m, types)
            except Exception as overpass_exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        "Nearby-stops lookup failed: "
                        f"Google error: {google_exc}; Overpass error: {overpass_exc}"
                    ),
                )

    try:
        return await _query_overpass(lat, lon, radius_m, types)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Nearby-stops lookup failed: {exc}",
        )
