import { useContext, useEffect, useRef, useState } from "react";
import { AmenityContext } from "../amenityContext";
import { useAppSettings } from "../AppSettingsContext";
import {
  AMENITY_LIST,
  AMENITY_FA_ICONS,
  AMENITY_ICONS,
  AMENITY_LABELS,
} from "../calculator/overpass";
import {
  MAP_TILE_LAYERS,
  GOOGLE_TILE_LAYER_KEYS,
  type MapTileLayerKey,
} from "../calculator/mapTileLayers";
import type { UnitSystem } from "../types";

// ── Radius helpers (mirrored from FindNearbyModal) ───────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────────

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
  unitSystem: UnitSystem;
}

export default function UserSettingsModal({
  open,
  onClose,
  unitSystem,
}: UserSettingsModalProps) {
  const {
    user,
    userSettings,
    updateUserSettings,
    enableGoogleMaps,
    enableGooglePlaces,
  } = useAppSettings();
  const {
    selectedTypes,
    textQuery,
    radiusM,
    setSelectedTypes,
    setTextQuery,
    setRadiusM,
  } = useContext(AmenityContext);

  const dialogRef = useRef<HTMLDialogElement>(null);

  // Local form state
  const [etaOpen, setEtaOpen] = useState(() =>
    String(userSettings.etaMarginOpen),
  );
  const [etaClose, setEtaClose] = useState(() =>
    String(userSettings.etaMarginClose),
  );
  const steps = stepsForUnit(unitSystem);
  const [sliderIndex, setSliderIndex] = useState(() =>
    closestStepIndex(radiusM, steps),
  );
  const [mapStyle, setMapStyle] = useState<MapTileLayerKey>(() =>
    userSettings.defaultMapStyle &&
    (!GOOGLE_TILE_LAYER_KEYS.has(userSettings.defaultMapStyle) ||
      enableGoogleMaps)
      ? userSettings.defaultMapStyle
      : "osm",
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Accordion section open/close state
  const [etaExpanded, setEtaExpanded] = useState(true);
  const [stopExpanded, setStopExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  // Sync local state when modal opens
  useEffect(() => {
    if (!open) return;
    setEtaOpen(String(userSettings.etaMarginOpen));
    setEtaClose(String(userSettings.etaMarginClose));
    setSliderIndex(closestStepIndex(radiusM, steps));
    const def = userSettings.defaultMapStyle;
    setMapStyle(
      def && (!GOOGLE_TILE_LAYER_KEYS.has(def) || enableGoogleMaps)
        ? def
        : "osm",
    );
    setValidationError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Open / close the native dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Auth guard — non-auth users should never see this
  if (!user) return null;

  function handleToggleType(type: string, checked: boolean) {
    const next = new Set(selectedTypes);
    if (checked) next.add(type);
    else next.delete(type);
    setSelectedTypes(next);
  }

  function handleSelectAll() {
    const allSelected = AMENITY_LIST.every((t) => selectedTypes.has(t));
    setSelectedTypes(allSelected ? new Set() : new Set(AMENITY_LIST));
  }

  function handleSave() {
    const openN = parseInt(etaOpen, 10);
    const closeN = parseInt(etaClose, 10);
    if (
      etaOpen.trim() === "" ||
      isNaN(openN) ||
      openN < 0 ||
      !Number.isInteger(openN) ||
      etaClose.trim() === "" ||
      isNaN(closeN) ||
      closeN < 0 ||
      !Number.isInteger(closeN)
    ) {
      setValidationError("ETA margins must be non-negative integers.");
      return;
    }

    const hasText = enableGooglePlaces && textQuery.trim().length > 0;
    if (!hasText && selectedTypes.size === 0) {
      setValidationError("Select at least one stop type.");
      return;
    }

    setValidationError(null);
    const currentRadiusM = steps[sliderIndex];
    setRadiusM(currentRadiusM);

    updateUserSettings({
      etaMarginOpen: openN,
      etaMarginClose: closeN,
      stopTypes: [...selectedTypes],
      stopRadiusM: currentRadiusM,
      defaultMapStyle: mapStyle,
    });
    onClose();
  }

  const currentRadiusM = steps[sliderIndex];

  return (
    <dialog
      ref={dialogRef}
      className="legend-modal user-settings-modal"
      onClose={onClose}
    >
      <div className="legend-header">
        <h2>Settings</h2>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="legend-body user-settings-body">
        {/* ── ETA Margins ───────────────────────────────────────────── */}
        <button
          type="button"
          className="section-action-row"
          onClick={() => setEtaExpanded((v) => !v)}
          aria-expanded={etaExpanded}
        >
          <span className={`chevron${etaExpanded ? " open" : ""}`}>▶</span>
          ETA Margins
        </button>
        {etaExpanded && (
          <div className="user-settings-section">
            <p className="user-settings-hint">
              Time windows (in minutes) for the &ldquo;Near open&rdquo; and
              &ldquo;Near close&rdquo; ETA badges on rest stops.
            </p>
            <div className="fields-grid">
              <div className="field">
                <label htmlFor="usm-eta-open">Near Open (min)</label>
                <input
                  id="usm-eta-open"
                  type="number"
                  min="0"
                  step="1"
                  value={etaOpen}
                  onChange={(e) => setEtaOpen(e.target.value)}
                />
                {(() => {
                  const v = parseInt(etaOpen, 10);
                  if (
                    etaOpen.trim() === "" ||
                    isNaN(v) ||
                    v < 0 ||
                    !Number.isInteger(v)
                  )
                    return (
                      <span className="field-error">
                        Must be a non-negative integer
                      </span>
                    );
                  return null;
                })()}
              </div>
              <div className="field">
                <label htmlFor="usm-eta-close">Near Close (min)</label>
                <input
                  id="usm-eta-close"
                  type="number"
                  min="0"
                  step="1"
                  value={etaClose}
                  onChange={(e) => setEtaClose(e.target.value)}
                />
                {(() => {
                  const v = parseInt(etaClose, 10);
                  if (
                    etaClose.trim() === "" ||
                    isNaN(v) ||
                    v < 0 ||
                    !Number.isInteger(v)
                  )
                    return (
                      <span className="field-error">
                        Must be a non-negative integer
                      </span>
                    );
                  return null;
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Stop Search Criteria ──────────────────────────────────── */}
        <button
          type="button"
          className="section-action-row"
          onClick={() => setStopExpanded((v) => !v)}
          aria-expanded={stopExpanded}
        >
          <span className={`chevron${stopExpanded ? " open" : ""}`}>▶</span>
          Stop Search Criteria
        </button>
        {stopExpanded && (
          <div className="user-settings-section">
            {/* Radius slider */}
            <div className="fnm-radius-row">
              <label className="fnm-radius-label" htmlFor="usm-radius-slider">
                Search radius:{" "}
                <strong>{fmtStep(currentRadiusM, unitSystem)}</strong>
              </label>
              <input
                id="usm-radius-slider"
                type="range"
                className="fnm-radius-slider"
                min={0}
                max={steps.length - 1}
                step={1}
                value={sliderIndex}
                onChange={(e) => setSliderIndex(Number(e.target.value))}
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

            {/* Stop type checkboxes */}
            <div className="fnm-checks-header">
              <span className="fnm-checks-title">Stop Types</span>
              <button
                type="button"
                className="action-btn action-btn-export fnm-select-all-btn"
                onClick={handleSelectAll}
                disabled={textQuery.trim().length > 0}
              >
                {AMENITY_LIST.every((t) => selectedTypes.has(t))
                  ? "Deselect All"
                  : "Select All"}
              </button>
            </div>
            <div className="fnm-checks">
              {AMENITY_LIST.map((type) => (
                <label
                  key={type}
                  className={`fnm-check-label${textQuery.trim().length > 0 ? " fnm-check-label--disabled" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(type)}
                    onChange={(e) => handleToggleType(type, e.target.checked)}
                    disabled={textQuery.trim().length > 0}
                  />
                  <span className="fnm-check-icon">
                    {AMENITY_FA_ICONS[type] ? (
                      <i
                        className={`fa-solid ${AMENITY_FA_ICONS[type]}`}
                        aria-hidden="true"
                      />
                    ) : (
                      (AMENITY_ICONS[type] ?? "📍")
                    )}
                  </span>
                  <span className="fnm-check-text">
                    {AMENITY_LABELS[type] ?? type}
                  </span>
                </label>
              ))}
            </div>

            {enableGooglePlaces && (
              <div className="fnm-text-search-section">
                <label
                  className="fnm-custom-label"
                  htmlFor="usm-text-query-input"
                >
                  Google Places text search
                  <span className="fnm-custom-hint">
                    {" "}
                    — disables type checkboxes
                  </span>
                </label>
                <input
                  id="usm-text-query-input"
                  type="text"
                  className="fnm-custom-input"
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="e.g. Walmart, Starbucks, bike shop"
                />
                <p
                  className="user-settings-hint"
                  style={{ marginTop: "0.45rem", marginBottom: 0 }}
                >
                  Text search applies to this session only and won&rsquo;t be
                  saved. Stop type checkboxes above are persisted to your
                  account.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Default Map Type ──────────────────────────────────────── */}
        <button
          type="button"
          className="section-action-row"
          onClick={() => setMapExpanded((v) => !v)}
          aria-expanded={mapExpanded}
        >
          <span className={`chevron${mapExpanded ? " open" : ""}`}>▶</span>
          Default Map Style
        </button>
        {mapExpanded && (
          <div className="user-settings-section">
            <p className="user-settings-hint">
              Applied as the starting map style for all map views.
            </p>
            <div className="field">
              <label htmlFor="usm-map-style">Map style</label>
              <select
                id="usm-map-style"
                value={mapStyle}
                onChange={(e) => setMapStyle(e.target.value as MapTileLayerKey)}
              >
                {(Object.keys(MAP_TILE_LAYERS) as MapTileLayerKey[]).map(
                  (key) => {
                    const isGoogle = GOOGLE_TILE_LAYER_KEYS.has(key);
                    if (isGoogle && !enableGoogleMaps) return null;
                    return (
                      <option key={key} value={key}>
                        {MAP_TILE_LAYERS[key].label}
                      </option>
                    );
                  },
                )}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="legend-footer">
        {validationError && (
          <p className="fnm-validation-error">{validationError}</p>
        )}
        <button
          type="button"
          className="action-btn action-btn-export"
          onClick={handleSave}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
