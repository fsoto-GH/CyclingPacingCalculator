import { useContext, useEffect, useRef, useState } from "react";
import { AmenityContext } from "../amenityContext";
import {
  AMENITY_LIST,
  AMENITY_ICONS,
  AMENITY_LABELS,
  queryNearbyAmenities,
} from "../calculator/overpass";
import type { NearbyAmenity } from "../calculator/overpass";

function fmtRadius(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

interface FindNearbyModalProps {
  lat: number;
  lon: number;
  radiusM: number;
  onResults: (results: NearbyAmenity[]) => void;
  onClose: () => void;
}

export default function FindNearbyModal({
  lat,
  lon,
  radiusM,
  onResults,
  onClose,
}: FindNearbyModalProps) {
  const { selectedTypes, customTypes, setSelectedTypes, setCustomTypes } =
    useContext(AmenityContext);
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
        radiusM,
        ctrl.signal,
        all,
      );
      if (ctrl.signal.aborted) return;
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
      setError("Search failed. Check your connection and try again.");
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
        <p className="fnm-desc">
          Search within {fmtRadius(radiusM)} of the split endpoint.
        </p>

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
        <button
          type="button"
          className="ghost-btn"
          onClick={handleCancel}
          disabled={loading}
        >
          Cancel
        </button>
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
