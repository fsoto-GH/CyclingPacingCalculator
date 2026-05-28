/**
 * Shared map utilities used by SplitEndpointMap and TransitSegmentMap.
 * Pure functions are in this file; React components that must live inside a
 * MapContainer are also exported here.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import type { RestStopForm, IntermediateRestStopForm } from "../types";
import { forwardGeocode, parseHighPrecisionCoordinateAddress } from "./geocode";
import { divIcon } from "leaflet";
import type { GpxTrackPoint, UnitSystem } from "../types";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Thin the track to one point every 50 m so Leaflet doesn't render tens of
 * thousands of segments. Always includes the first and last point.
 */
export function decimateTrack(track: GpxTrackPoint[]): [number, number][] {
  if (track.length === 0) return [];
  const result: [number, number][] = [[track[0].lat, track[0].lon]];
  const MIN_KM = 0.05;
  let prevKm = track[0].cumDist;
  for (let i = 1; i < track.length; i++) {
    if (track[i].cumDist - prevKm >= MIN_KM) {
      result.push([track[i].lat, track[i].lon]);
      prevKm = track[i].cumDist;
    }
  }
  const last = track[track.length - 1];
  result.push([last.lat, last.lon]);
  return result;
}

/** Human-readable distance from metres. */
export function fmtDist(m: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    const mi = m / 1609.34;
    return mi < 0.1
      ? `${Math.round(m * 3.28084)} ft`
      : `${mi.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  }
  return m < 1000
    ? `${Math.round(m)} m`
    : `${(m / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

/** Forward azimuth in degrees (0 = north, clockwise). */
export function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Purple location-pin DivIcon used for rest stop markers. */
export function makeRestStopIcon() {
  return divIcon({
    html: '<div class="split-rest-stop-pin"><i class="fa-solid fa-location-dot"></i></div>',
    className: "",
    iconSize: [20, 28],
    iconAnchor: [10, 27],
    popupAnchor: [0, -24],
  });
}

// ── Map sub-components (must render inside a MapContainer) ───────────────────
/**
 * Fires a forward-geocode whenever the rest-stop address changes and the stop
 * does not yet have lat/lon coords.  Calls `onSelectStop` with the resolved
 * coordinates.  Shared by SplitEndpointMap and TransitSegmentMap.
 */
export function useRestStopGeocode(
  restStop: RestStopForm | null | undefined,
  onSelectStop: ((patch: Partial<RestStopForm>) => void) | undefined,
): void {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const rs = restStop;
    if (!rs?.enabled || !rs.address?.trim()) return;
    if (!onSelectStop) return;

    const parsed = parseHighPrecisionCoordinateAddress(rs.address);
    if (parsed) {
      abortRef.current?.abort();
      if (rs.lat === parsed.lat && rs.lon === parsed.lon) return;
      onSelectStop({ lat: parsed.lat, lon: parsed.lon });
      return;
    }

    if (rs.lat != null && rs.lon != null) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const address = rs.address.trim();
    const query = address; // Don't include the name in the geocoding query since it often confuses the geocoder and makes results worse.

    forwardGeocode(query, ctrl.signal).then((result) => {
      if (ctrl.signal.aborted || !result) return;
      onSelectStop({ lat: result.lat, lon: result.lon });
    });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restStop?.enabled, restStop?.address, restStop?.name, onSelectStop]);
}

/**
 * Fires a forward-geocode whenever the intermediate stop address changes.
 * Unlike useRestStopGeocode, this re-geocodes even when lat/lon are already
 * set — the user may have clicked the map to place the stop, then updated the
 * address to a named location, and we must move the pin to match.
 * A ref tracks the last successfully geocoded address so we don't re-fire on
 * every render (which would cause an infinite loop).
 */
export function useIntermediateStopGeocode(
  intermediateStop: IntermediateRestStopForm | null | undefined,
  onSelectStop: ((patch: Partial<IntermediateRestStopForm>) => void) | undefined,
): void {
  const abortRef = useRef<AbortController | null>(null);
  const lastGeocodedAddressRef = useRef<string | null>(null);

  useEffect(() => {
    const rs = intermediateStop;
    if (!rs?.enabled || !rs.address?.trim()) return;
    if (!onSelectStop) return;

    const trimmed = rs.address.trim();

    const parsed = parseHighPrecisionCoordinateAddress(trimmed);
    if (parsed) {
      abortRef.current?.abort();
      if (rs.lat === parsed.lat && rs.lon === parsed.lon) return;
      onSelectStop({ lat: parsed.lat, lon: parsed.lon });
      lastGeocodedAddressRef.current = trimmed;
      return;
    }

    // Skip if we already geocoded this exact address and coords are set.
    if (
      rs.lat != null &&
      rs.lon != null &&
      lastGeocodedAddressRef.current === trimmed
    )
      return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    forwardGeocode(trimmed, ctrl.signal).then((result) => {
      if (ctrl.signal.aborted || !result) return;
      lastGeocodedAddressRef.current = trimmed;
      onSelectStop({ lat: result.lat, lon: result.lon });
    });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intermediateStop?.enabled, intermediateStop?.address, onSelectStop]);
}

export function ScrollWheelActivator() {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.disable();
    const el = map.getContainer();
    const enable = () => map.scrollWheelZoom.enable();
    const disable = () => map.scrollWheelZoom.disable();
    el.addEventListener("click", enable);
    el.addEventListener("mouseleave", disable);
    return () => {
      el.removeEventListener("click", enable);
      el.removeEventListener("mouseleave", disable);
    };
  }, [map]);
  return null;
}
