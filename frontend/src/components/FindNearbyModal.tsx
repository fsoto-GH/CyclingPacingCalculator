import { useContext, useEffect, useRef, useState } from "react";
import { AmenityContext } from "../amenityContext";
import {
  AMENITY_LIST,
  AMENITY_ICONS,
  AMENITY_LABELS,
  queryNearbyAmenities,
} from "../calculator/overpass";
import type { NearbyAmenity } from "../calculator/overpass";

import type { UnitSystem } from "../types";

// Preset radius steps per unit system.
// Index 4+ is considered "large" and shows a slow-search warning.
const IMPERIAL_STEPS_MI = [0.5, 1, 2, 3, 5, 10, 15, 25];
const METRIC_STEPS_KM = [1, 2, 5, 8, 10, 15, 25, 40];
const WARN_INDEX = 4;

function stepsForUnit(unitSystem: UnitSystem): number[] {
  return unitSystem === "imperial"
    ? IMPERIAL_STEPS_MI.map((mi) => mi * 1609.34)
    : METRIC_STEPS_KM.map((km) => km * 1000);
}

function closestStepIndex(radiusM: number, steps: number[]): number {
  let best = 0;
  let bestDiff = Infinity;
  steps.forEach((s, i) => {
    const diff = Math.abs(s - radiusM);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

function fmtStep(stepM: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    const mi = stepM / 1609.34;
    return `${mi % 1 === 0 ? mi.toFixed(0) : mi.toFixed(1)} mi`;
  }
  const km = stepM / 1000;
  return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`;
}

interface FindNearbyModalProps {
  lat: number;
  lon: number;
  unitSystem: UnitSystem;
  onResults: (results: NearbyAmenity[]) => void;
  onClose: () => void;
}

export default function FindNearbyModal({
  lat,
  lon,
  unitSystem,
  onResults,
  onClose,
}: FindNearbyModalProps) {
  const {
    selectedTypes,
    customTypes,
    radiusM,
    setSelectedTypes,
    setCustomTypes,
    setRadiusM,
  } = useContext(AmenityContext);
  const steps = stepsForUnit(unitSystem);
  const [sliderIndex, setSliderIndex] = useState(() =>
    closestStepIndex(radiusM, steps),
  );
  const currentRadiusM = steps[sliderIndex];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open the native dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleToggle(type: string, checked: boolean) {
    const next = new Set(selectedTypes);
    if (checked) next.add(type);
    else next.delete(type);
    setSelectedTypes(next);
  }

  function handleSelectAll() {
    const allSelected = AMENITY_LIST.every((t) => selectedTypes.has(t));
    setSelectedTypes(allSelected ? new Set() : new Set(AMENITY_LIST));
  }

  async function handleSearch() {
    const custom = customTypes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const all = [...selectedTypes, ...custom];
    if (all.length === 0) {
      setError("Select at least one stop type.");
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);

    try {
      let results = await queryNearbyAmenities(
        lat,
        lon,
        currentRadiusM,
        ctrl.signal,
        all,
      );
      if (ctrl.signal.aborted) return;
      setRadiusM(currentRadiusM);
      const byDistThenName = (a: (typeof results)[0], b: (typeof results)[0]) =>
        a.distanceM - b.distanceM || a.name.localeCompare(b.name);
      const withHours = results
        .filter((r) => r.hours != null)
        .sort(byDistThenName);
      const noHours = results
        .filter((r) => r.hours == null)
        .sort(byDistThenName);
      results = [...withHours, ...noHours];
      onResults(results);
      onClose();
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") return;
      const msg = (err as { message?: string }).message ?? "";
      if (msg.startsWith("OVERPASS_OOM:")) {
        setError(
          "Search exceeded available memory — try a smaller radius or fewer stop types.",
        );
      } else {
        setError("Search failed. Check your connection and try again.");
      }
      setLoading(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="legend-modal find-nearby-modal"
      onClose={onClose}
    >
      <div className="legend-header">
        <h2>Find Nearby Stops</h2>
        <button
          className="legend-close"
          onClick={handleCancel}
          disabled={loading}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="legend-body">
        <div className="fnm-radius-row">
          <label className="fnm-radius-label" htmlFor="fnm-radius-slider">
            Search radius:{" "}
            <strong>{fmtStep(currentRadiusM, unitSystem)}</strong>
          </label>
          <input
            id="fnm-radius-slider"
            type="range"
            className="fnm-radius-slider"
            min={0}
            max={steps.length - 1}
            step={1}
            value={sliderIndex}
            onChange={(e) => setSliderIndex(Number(e.target.value))}
            disabled={loading}
          />
          <div className="fnm-radius-ticks">
            {steps.map((s, i) => (
              <span
                key={i}
                className={i === sliderIndex ? "fnm-tick-active" : ""}
              >
                {fmtStep(s, unitSystem)}
              </span>
            ))}
          </div>
          {sliderIndex >= WARN_INDEX ? (
            <p className="fnm-radius-warn">
              ⚠ Large radius — search may take a while.
            </p>
          ) : (
            <p
              className="fnm-radius-warn fnm-radius-warn--hidden"
              aria-hidden="true"
            >
              &nbsp;
            </p>
          )}
        </div>

        <div className="fnm-checks-header">
          <span className="fnm-checks-title">Stop Types</span>
          <button
            type="button"
            className="fnm-select-all-btn"
            onClick={handleSelectAll}
            disabled={loading}
          >
            {AMENITY_LIST.every((t) => selectedTypes.has(t))
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>
        <div className="fnm-checks">
          {AMENITY_LIST.map((type) => (
            <label key={type} className="fnm-check-label">
              <input
                type="checkbox"
                checked={selectedTypes.has(type)}
                onChange={(e) => handleToggle(type, e.target.checked)}
                disabled={loading}
              />
              <span className="fnm-check-icon">
                {AMENITY_ICONS[type] ?? "📍"}
              </span>
              <span className="fnm-check-text">
                {AMENITY_LABELS[type] ?? type}
              </span>
            </label>
          ))}
        </div>

        <div className="fnm-custom-section">
          <label className="fnm-custom-label" htmlFor="fnm-custom-input">
            Additional types{" "}
            <span className="fnm-custom-hint">
              (comma-separated OSM amenity tags)
            </span>
          </label>
          <input
            id="fnm-custom-input"
            type="text"
            className="fnm-custom-input"
            value={customTypes}
            onChange={(e) => setCustomTypes(e.target.value)}
            placeholder="e.g. toilets, atm, bicycle_rental"
            disabled={loading}
          />
        </div>

        {error && <p className="fnm-error">{error}</p>}
      </div>

      <div className="legend-footer">
        <a
          href={(() => {
            const custom = customTypes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const all = [...Array.from(selectedTypes), ...custom];
            const query =
              all.length > 0
                ? all.map((t) => t.replace(/_/g, "+")).join("+")
                : "restaurants+gas+stations+supermarkets";
            return `https://www.google.com/maps/search/${query}/@${lat},${lon},14z`;
          })()}
          target="_blank"
          rel="noopener noreferrer"
          className="ghost-btn fnm-maps-link"
        >
          Scout in Google Maps
        </a>
        <button
          type="button"
          className="ghost-btn fnm-search-btn"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "Searching…" : "Search Nearby"}
        </button>
      </div>
    </dialog>
  );
}
