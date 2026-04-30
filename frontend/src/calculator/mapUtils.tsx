/**
 * Shared map utilities used by SplitEndpointMap and TransitSegmentMap.
 * Pure functions are in this file; React components that must live inside a
 * MapContainer are also exported here.
 */

import { useEffect } from "react";
import { useMap } from "react-leaflet";
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
 * Disables scroll-wheel zoom until the user clicks the map, and re-disables
 * it when the mouse leaves — prevents accidental zoom while scrolling the
 * page past the map.
 */
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
