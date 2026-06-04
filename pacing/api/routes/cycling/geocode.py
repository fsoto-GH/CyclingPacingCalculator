"""
Backend geocoding endpoints with OSM-first lookup strategy.

Behavior:
- OSM is queried first and cached in Redis (30-day TTL).
- If OSM returns HTTP 429, a 1-hour cooldown is set and Google Geocoding is
  used as fallback for that period.
- Endpoints are gated by per-user `enable_google_geocoding`.
"""

from __future__ import annotations

import logging
import hashlib
import json
import re
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from redis.asyncio import Redis

from pacing.api.auth.deps import CurrentUser, get_google_geocoding_user
from pacing.api.config import settings

router = APIRouter(prefix="/v1/cycling/geocode", tags=["cycling"])
logger = logging.getLogger(__name__)

OSM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
OSM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
USER_AGENT = "UltraCyclingPlanner/1.0"
CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
OSM_COOLDOWN_SECONDS = 60 * 60
OSM_COOLDOWN_KEY = "geocode:osm:block_until"

_redis_client: Redis | None = None
_local_cache: dict[str, tuple[float, str]] = {}
_local_osm_blocked_until = 0.0


class ReverseGeocodeResponse(BaseModel):
    label: str | None


class SearchGeocodeResult(BaseModel):
    lat: float
    lon: float
    type: Optional[str] = None
    place_class: Optional[str] = None
    name: Optional[str] = None


class SearchGeocodeResponse(BaseModel):
    result: SearchGeocodeResult | None


class OSMRateLimitedError(Exception):
    pass


def _redis() -> Redis | None:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    if not settings.redis_url:
        return None
    _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def _reverse_cache_key(lat: float, lon: float, kind: str) -> str:
    return f"geocode:reverse:{kind}:{lat:.4f}:{lon:.4f}"


def _search_cache_key(query: str) -> str:
    normalized = re.sub(r"\s+", " ", query.strip().lower())
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
    return f"geocode:search:{digest}"


async def _cache_get(key: str) -> Optional[dict[str, Any]]:
    now = time.time()
    r = _redis()
    if r is not None:
        raw = await r.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            await r.delete(key)
            return None

    local = _local_cache.get(key)
    if local is None:
        return None
    exp_ts, payload = local
    if now >= exp_ts:
        _local_cache.pop(key, None)
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        _local_cache.pop(key, None)
        return None


async def _cache_set(key: str, value: dict[str, Any]) -> None:
    payload = json.dumps(value)
    r = _redis()
    if r is not None:
        await r.set(key, payload, ex=CACHE_TTL_SECONDS)
        return
    _local_cache[key] = (time.time() + CACHE_TTL_SECONDS, payload)


async def _is_osm_blocked() -> bool:
    global _local_osm_blocked_until
    now = time.time()
    r = _redis()
    if r is not None:
        raw = await r.get(OSM_COOLDOWN_KEY)
        if raw is None:
            return False
        try:
            return now < float(raw)
        except ValueError:
            await r.delete(OSM_COOLDOWN_KEY)
            return False
    return now < _local_osm_blocked_until


async def _set_osm_blocked() -> None:
    global _local_osm_blocked_until
    block_until = time.time() + OSM_COOLDOWN_SECONDS
    r = _redis()
    if r is not None:
        await r.set(OSM_COOLDOWN_KEY, str(block_until), ex=OSM_COOLDOWN_SECONDS)
        return
    _local_osm_blocked_until = block_until


def _extract_state_abbrev(subdivision_code: str | None) -> str | None:
    if not subdivision_code:
        return None
    parts = subdivision_code.split("-")
    if len(parts) < 2:
        return None
    code = parts[-1].strip()
    return code if re.fullmatch(r"[A-Z]{2,3}", code) else None


def _label_from_osm_reverse(data: dict[str, Any], kind: str) -> str | None:
    addr = data.get("address") or {}
    if kind == "address":
        street = " ".join(
            [x for x in [addr.get("house_number"), addr.get("road")] if x]
        ).strip()
        locality = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("hamlet")
            or addr.get("county")
            or ""
        )
        parts = [x for x in [street, locality, addr.get("state")] if x]
        return ", ".join(parts) if parts else None

    subdivision_abbrev = _extract_state_abbrev(addr.get("ISO3166-2-lvl4"))
    place = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("hamlet")
        or addr.get("municipality")
        or addr.get("county")
        or addr.get("state_district")
        or addr.get("state")
        or addr.get("country")
    )
    if not place:
        return None
    state = subdivision_abbrev or addr.get("state")
    if state and place != addr.get("state"):
        return f"{place}, {state}"
    return place


def _label_from_google_reverse(results: list[dict[str, Any]], kind: str) -> str | None:
    if not results:
        return None
    first = results[0]
    if kind == "address":
        return first.get("formatted_address")

    components = first.get("address_components") or []
    locality = None
    admin_area_short = None
    admin_area_long = None
    for component in components:
        types = component.get("types") or []
        if "locality" in types and not locality:
            locality = component.get("long_name")
        if "administrative_area_level_1" in types:
            admin_area_short = component.get("short_name")
            admin_area_long = component.get("long_name")

    if locality and admin_area_short:
        return f"{locality}, {admin_area_short}"
    if locality and admin_area_long:
        return f"{locality}, {admin_area_long}"
    return locality or first.get("formatted_address")


async def _osm_reverse(lat: float, lon: float, kind: str) -> str | None:
    params = {
        "format": "json",
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "accept-language": "en",
        "zoom": "18" if kind == "address" else "10",
        "addressdetails": "1",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            OSM_REVERSE_URL,
            params=params,
            headers={"User-Agent": USER_AGENT},
        )
    if resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise OSMRateLimitedError("OSM reverse geocode rate-limited")
    if not resp.is_success:
        return None
    payload = resp.json()
    if payload.get("error"):
        return None
    return _label_from_osm_reverse(payload, kind)


async def _google_reverse(lat: float, lon: float, kind: str) -> str | None:
    api_key = settings.google_api_key
    if not api_key:
        return None

    params = {
        "latlng": f"{lat:.6f},{lon:.6f}",
        "language": "en",
        "key": api_key,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(GOOGLE_GEOCODE_URL, params=params)
    if not resp.is_success:
        return None

    payload = resp.json()
    if payload.get("status") != "OK":
        return None
    results = payload.get("results") or []
    return _label_from_google_reverse(results, kind)


async def _osm_search(query: str) -> SearchGeocodeResult | None:
    params = {
        "q": query,
        "format": "json",
        "limit": "1",
        "accept-language": "en",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            OSM_SEARCH_URL,
            params=params,
            headers={"User-Agent": USER_AGENT},
        )
    if resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise OSMRateLimitedError("OSM search geocode rate-limited")
    if not resp.is_success:
        return None

    rows = resp.json()
    if not rows:
        return None

    row = rows[0]
    return SearchGeocodeResult(
        lat=float(row["lat"]),
        lon=float(row["lon"]),
        type=row.get("type"),
        place_class=row.get("class"),
        name=row.get("name") or row.get("display_name"),
    )


async def _google_search(query: str) -> SearchGeocodeResult | None:
    api_key = settings.google_api_key
    if not api_key:
        return None

    params = {
        "address": query,
        "language": "en",
        "key": api_key,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(GOOGLE_GEOCODE_URL, params=params)
    if not resp.is_success:
        return None

    payload = resp.json()
    if payload.get("status") != "OK":
        return None

    rows = payload.get("results") or []
    if not rows:
        return None

    row = rows[0]
    location = (row.get("geometry") or {}).get("location") or {}
    if "lat" not in location or "lng" not in location:
        return None

    types = row.get("types") or []
    return SearchGeocodeResult(
        lat=float(location["lat"]),
        lon=float(location["lng"]),
        type=types[0] if types else None,
        place_class=types[1] if len(types) > 1 else None,
        name=row.get("formatted_address"),
    )


@router.get("/reverse", response_model=ReverseGeocodeResponse)
async def reverse_geocode(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    kind: str = Query("city", pattern="^(city|address)$"),
    current_user: CurrentUser = Depends(get_google_geocoding_user),
):
    del current_user  # consumed by dependency

    key = _reverse_cache_key(lat, lon, kind)
    cached = await _cache_get(key)
    if cached is not None:
        logger.debug(
            "Cache hit for reverse geocode (%0.4f, %0.4f, %s): %s",
            lat,
            lon,
            kind,
            cached.get("label"),
        )
        return ReverseGeocodeResponse(label=cached.get("label"))

    try:
        if await _is_osm_blocked():
            logger.info(
                "OSM blocked, using Google for reverse geocode (%0.4f, %0.4f, %s)",
                lat,
                lon,
                kind,
            )
            label = await _google_reverse(lat, lon, kind)
        else:
            logger.debug(
                "Using OSM for reverse geocode (%0.4f, %0.4f, %s)",
                lat,
                lon,
                kind,
            )
            label = await _osm_reverse(lat, lon, kind)
    except OSMRateLimitedError:
        logger.warning(
            "OSM rate-limited for reverse geocode; blocking for %s seconds",
            OSM_COOLDOWN_SECONDS,
        )
        await _set_osm_blocked()
        label = await _google_reverse(lat, lon, kind)

    await _cache_set(key, {"label": label})
    return ReverseGeocodeResponse(label=label)


@router.get("/search", response_model=SearchGeocodeResponse)
async def search_geocode(
    query: str = Query(..., min_length=1, max_length=200),
    current_user: CurrentUser = Depends(get_google_geocoding_user),
):
    del current_user  # consumed by dependency

    trimmed = query.strip()
    if not trimmed:
        return SearchGeocodeResponse(result=None)

    key = _search_cache_key(trimmed)
    cached = await _cache_get(key)
    if cached is not None:
        logger.debug(
            "Cache hit for search geocode (%r): %s",
            trimmed,
            cached.get("result"),
        )
        result = cached.get("result")
        return SearchGeocodeResponse(
            result=SearchGeocodeResult(**result) if result else None
        )

    try:
        if await _is_osm_blocked():
            logger.info("OSM blocked, using Google for search geocode (%r)", trimmed)
            result = await _google_search(trimmed)
        else:
            logger.debug("Using OSM for search geocode (%r)", trimmed)
            result = await _osm_search(trimmed)
    except OSMRateLimitedError:
        logger.warning(
            "OSM rate-limited for search geocode; blocking for %s seconds",
            OSM_COOLDOWN_SECONDS,
        )
        await _set_osm_blocked()
        result = await _google_search(trimmed)

    await _cache_set(key, {"result": result.model_dump() if result else None})
    return SearchGeocodeResponse(result=result)
