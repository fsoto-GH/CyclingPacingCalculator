import { useState, useEffect, useRef } from "react";
import type {
  SplitForm,
  SubSplitMode,
  UnitSystem,
  SplitGpxProfile,
  GpxTrackPoint,
} from "../types";
import { speedLabel, distanceLabel, minutesToHms } from "../utils";
import TimeInput from "./TimeInput";
import RestStopFormComponent from "./RestStopForm";
import TimezoneSelect from "./TimezoneSelect";
import { FieldError } from "./FieldError";
import SplitEndpointMap from "./SplitEndpointMap";

interface SplitFormProps {
  segIndex: number;
  splitIndex: number;
  value: SplitForm;
  onChange: (val: SplitForm) => void;
  unitSystem: UnitSystem;
  isLast?: boolean;
  /** True only for the final split of the final segment across the whole course */
  isLastOverall?: boolean;
  includeEndDownTime?: boolean;
  /** Calculated per-split distance in user units (differs from input in target_distance mode) */
  splitDistUser?: number | null;
  gpxProfile?: SplitGpxProfile | null;
  gpxTrack?: GpxTrackPoint[] | null;
  courseTz: string;
  gpxDistStatus?: "over" | "under-last" | null;
  nearbyCity?: string | null;
  nearbyCity_fetching?: boolean;
  /** Cumulative course distance at the END of this split, in user units */
  cumulativeDist?: number | null;
  /** Total GPX track length in user units */
  gpxTotalDist?: number | null;
}

export default function SplitFormComponent({
  segIndex,
  splitIndex,
  value,
  onChange,
  unitSystem,
  isLast,
  isLastOverall,
  includeEndDownTime,
  splitDistUser,
  gpxProfile,
  gpxTrack,
  courseTz,
  gpxDistStatus,
  nearbyCity,
  nearbyCity_fetching,
  cumulativeDist,
  gpxTotalDist,
}: SplitFormProps) {
  const update = (patch: Partial<SplitForm>) =>
    onChange({ ...value, ...patch });
  const [addressLoading, setAddressLoading] = useState(false);

  // Auto-detect timezone from GPX endpoint. Runs whenever the detected tz
  // or the course tz changes; leaves any *manually* set timezone alone once
  // the GPX profile is gone.
  useEffect(() => {
    const detectedTz = gpxProfile?.endTimezone ?? null;
    if (detectedTz && detectedTz !== courseTz) {
      // Endpoint is in a different tz — enable the override
      if (!value.differentTimezone || value.timezone !== detectedTz) {
        onChange({ ...value, differentTimezone: true, timezone: detectedTz });
      }
    } else if (
      detectedTz === courseTz &&
      value.differentTimezone &&
      value.timezone === detectedTz
    ) {
      // Endpoint tz matches the course tz — clear the auto-set override
      onChange({ ...value, differentTimezone: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxProfile?.endTimezone, courseTz]);

  const hasOptionalValues =
    !!value.moving_speed ||
    !!value.down_time ||
    !!value.adjustment_time ||
    value.differentTimezone;
  const [showOptional, setShowOptional] = useState(hasOptionalValues);
  const [collapsed, setCollapsed] = useState(true);

  // ── Three-state layout slider (Form | Both | Map) ──────────────────────────
  // Only active when GPX is loaded + endpoint coords are available + distance set.
  type LayoutState = "form" | "both" | "map";
  const [layoutState, setLayoutState] = useState<LayoutState>("form");
  const [formColWidth, setFormColWidth] = useState(350);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const splitFormRef = useRef<HTMLDivElement | null>(null);
  // Seed from actual window width so mobile first-render is already stacked
  // (prevents Leaflet from initialising into a 0-height container)
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 520,
  );

  // Track container width to auto-stack the "both" layout when narrow
  useEffect(() => {
    const el = splitFormRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < 520);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Condition that unlocks the slider UI
  const mapAvailable =
    !!gpxTrack && gpxProfile?.endLat != null && !!value.distance;

  // Reset to "form" when the map becomes unavailable mid-session
  useEffect(() => {
    if (!mapAvailable && layoutState !== "form") {
      setLayoutState("form");
    }
  }, [mapAvailable, layoutState]);

  // Mouse drag — attach to document so the handle doesn't need to be held
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      setFormColWidth(
        Math.min(500, Math.max(350, dragStartWidth.current + delta)),
      );
    }
    function onMouseUp() {
      isDragging.current = false;
      resizeHandleRef.current?.classList.remove("active");
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Thumb pixel positions for the three slider states
  const THUMB_POS: Record<LayoutState, number> = {
    form: 2,
    both: 53,
    map: 104,
  };

  function handleSliderClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const third = rect.width / 3;
    const idx: LayoutState =
      x < third ? "form" : x < 2 * third ? "both" : "map";
    setLayoutState(idx);
  }
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);
  const prefix = `seg${segIndex}-split${splitIndex}`;

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    unitSystem === "imperial" ? Math.round(m * 3.28084) : m;

  const downHms = minutesToHms(value.down_time);
  const adjHms = minutesToHms(value.adjustment_time);
  const displayName = value.name?.trim() || null;
  const headerTitle = displayName ? displayName : `Split ${splitIndex + 1}`;
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Timezone badge — shown whenever a split timezone override is active
  const activeTz =
    value.differentTimezone && value.timezone ? value.timezone : null;
  const tzBadgeAbbr = activeTz
    ? (new Intl.DateTimeFormat("en-US", {
        timeZone: activeTz,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? activeTz)
    : null;

  return (
    <div className="split-form" ref={splitFormRef}>
      <div className="split-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="collapse-icon-sm">{collapsed ? "▶" : "▼"}</span>
        <div className="split-header-left">
          <div className="split-header-title-row">
            <span className="split-header-title">
              {headerTitle}
              {gpxDistStatus === "over" && (
                <span
                  className="gpx-dist-asterisk gpx-dist-asterisk--over"
                  title="Split distance exceeds GPX track total"
                >
                  {" "}
                  *
                </span>
              )}
              {gpxDistStatus === "under-last" && (
                <span
                  className="gpx-dist-asterisk gpx-dist-asterisk--under"
                  title="Total distance has not reached GPX track total"
                >
                  {" "}
                  *
                </span>
              )}
            </span>
            {collapsed && (downHms || adjHms || value.distance) && (
              <span className="split-header-summary">
                {[
                  value.distance ? `${value.distance} ${dLabel}` : null,
                  downHms ? `↓${downHms}` : null,
                  adjHms ? `±${adjHms}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "(no distance)"}
              </span>
            )}
          </div>
          {(gpxProfile || tzBadgeAbbr || splitDistUser != null) && (
            <div className="split-header-meta">
              {splitDistUser != null && (
                <span className="split-header-meta-item" title="Split distance">
                  {splitDistUser.toFixed(1)} {dLabel}
                </span>
              )}
              {tzBadgeAbbr && (
                <span
                  className="split-header-meta-item"
                  title={`Split timezone: ${activeTz}`}
                >
                  🕐 {tzBadgeAbbr}
                </span>
              )}
              {gpxProfile && (
                <>
                  <span
                    className="split-header-meta-item"
                    title="Elevation gain"
                  >
                    ⬆ {toElevUnit(gpxProfile.elevGainM)}
                    {elevUnit}
                  </span>
                  <span
                    className="split-header-meta-item"
                    title="Elevation loss"
                  >
                    ⬇ {toElevUnit(gpxProfile.elevLossM)}
                    {elevUnit}
                  </span>
                  <span
                    className="split-header-meta-item"
                    title="Average grade"
                  >
                    {gpxProfile.avgGradePct.toFixed(1)}% avg
                  </span>
                  {gpxProfile.steepPct > 0 && (
                    <span
                      className="split-header-meta-item"
                      title="% of distance with grade > 5%"
                    >
                      ⚠ {gpxProfile.steepPct}% steep
                    </span>
                  )}
                  {gpxProfile.surface !== "unknown" && (
                    <span
                      className="split-header-meta-item"
                      title="Dominant surface"
                    >
                      {gpxProfile.surface}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {cumulativeDist != null && gpxTotalDist != null && (
          <div
            className="split-header-right"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const diff = cumulativeDist - gpxTotalDist;
              const absDiff = Math.abs(diff);
              const sign =
                diff > 0.05 ? "over" : diff < -0.05 ? "under" : "exact";
              const distColor =
                sign === "exact"
                  ? "#4ade80"
                  : sign === "over"
                    ? "#f87171"
                    : isLastOverall
                      ? "#facc15"
                      : undefined;
              return (
                <>
                  <span
                    className="split-header-dist"
                    style={{ color: distColor }}
                  >
                    {cumulativeDist.toFixed(1)} {dLabel}
                  </span>
                  <span className="split-header-city">
                    {nearbyCity_fetching && (
                      <span className="split-nearby-city--loading">
                        (finding nearest city…) ·{" "}
                      </span>
                    )}
                    {!nearbyCity_fetching && nearbyCity && `${nearbyCity} · `}
                    {sign === "exact"
                      ? "✓ matches GPX"
                      : sign === "under"
                        ? `${absDiff.toFixed(1)} ${dLabel} left`
                        : `${absDiff.toFixed(1)} ${dLabel} over`}
                  </span>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {!collapsed && mapAvailable && (
        <div className="split-view-bar">
          <div
            className="split-tri-slider"
            onClick={handleSliderClick}
            role="group"
            aria-label="Layout"
          >
            <div className="split-tri-track" />
            <div
              className="split-tri-thumb"
              style={{ left: `${THUMB_POS[layoutState]}px` }}
            />
            <div className="split-tri-labels">
              {(["form", "both", "map"] as const).map((s) => (
                <span
                  key={s}
                  className={`split-tri-label${layoutState === s ? " active" : ""}`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {!collapsed &&
        (() => {
          // ── Shared form content (distance, overrides, sub-splits, rest stop) ──
          const formContent = (
            <>
              {/* Row 0: Split name */}
              <div className="field segment-name-field split-name-field">
                <input
                  id={`${prefix}-name`}
                  type="text"
                  placeholder={`Split ${splitIndex + 1} name (optional)`}
                  value={value.name ?? ""}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </div>

              {/* Row 1: Distance */}
              <div className="field">
                <label htmlFor={`${prefix}-distance`}>
                  Distance ({dLabel}) *
                </label>
                <input
                  id={`${prefix}-distance`}
                  type="number"
                  step="any"
                  min="0"
                  value={value.distance}
                  onChange={(e) => update({ distance: e.target.value })}
                />
                <FieldError fieldId={`${prefix}-distance`} />
              </div>

              {/* Row 2: Sub-splits — mode dropdown + conditional option */}
              <div className="fields-grid fields-grid--2col">
                <div className="field">
                  <label htmlFor={`${prefix}-ssm`}>Sub-Split Mode</label>
                  <select
                    id={`${prefix}-ssm`}
                    value={value.sub_split_mode}
                    onChange={(e) =>
                      update({
                        sub_split_mode: e.target.value as SubSplitMode,
                      })
                    }
                  >
                    <option value="even">Even</option>
                    <option value="fixed">Fixed Size</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {value.sub_split_mode === "even" && (
                  <div className="field">
                    <label htmlFor={`${prefix}-ss-count`}>Count *</label>
                    <input
                      id={`${prefix}-ss-count`}
                      type="number"
                      min="1"
                      step="1"
                      value={value.sub_split_count}
                      onChange={(e) =>
                        update({ sub_split_count: e.target.value })
                      }
                    />
                    <FieldError fieldId={`${prefix}-ss-count`} />
                  </div>
                )}

                {value.sub_split_mode === "fixed" && (
                  <div className="field">
                    <label htmlFor={`${prefix}-ss-distance`}>
                      Size ({dLabel}) *
                    </label>
                    <input
                      id={`${prefix}-ss-distance`}
                      type="number"
                      step="any"
                      value={value.sub_split_distance}
                      onChange={(e) =>
                        update({ sub_split_distance: e.target.value })
                      }
                    />
                    <FieldError fieldId={`${prefix}-ss-distance`} />
                  </div>
                )}

                {value.sub_split_mode === "custom" && (
                  <div className="field">
                    <label htmlFor={`${prefix}-ss-distances`}>
                      Distances (comma-sep.) *
                    </label>
                    <input
                      id={`${prefix}-ss-distances`}
                      type="text"
                      value={value.sub_split_distances}
                      onChange={(e) =>
                        update({ sub_split_distances: e.target.value })
                      }
                      placeholder="e.g. 10, 20, 30"
                    />
                    <FieldError fieldId={`${prefix}-ss-distances`} />
                  </div>
                )}
              </div>

              {/* Fixed mode: threshold on its own row */}
              {value.sub_split_mode === "fixed" && (
                <div className="field">
                  <label htmlFor={`${prefix}-ss-threshold`}>
                    Last Threshold ({dLabel}) *
                  </label>
                  <input
                    id={`${prefix}-ss-threshold`}
                    type="number"
                    step="any"
                    value={value.last_sub_split_threshold}
                    onChange={(e) =>
                      update({ last_sub_split_threshold: e.target.value })
                    }
                  />
                  <FieldError fieldId={`${prefix}-ss-threshold`} />
                </div>
              )}

              {/* Action row: Overrides toggle */}
              <button
                type="button"
                className="section-action-row"
                onClick={() => setShowOptional(!showOptional)}
              >
                <span className={`chevron${showOptional ? " open" : ""}`}>
                  ▶
                </span>
                Overrides
              </button>

              {showOptional && (
                <div className="optional-fields fields-grid">
                  <div className="field">
                    <label htmlFor={`${prefix}-moving-speed`}>
                      Speed ({sLabel})
                    </label>
                    <input
                      id={`${prefix}-moving-speed`}
                      type="number"
                      step="any"
                      value={value.moving_speed}
                      onChange={(e) => update({ moving_speed: e.target.value })}
                      placeholder="Inherits"
                    />
                    <FieldError fieldId={`${prefix}-moving-speed`} />
                  </div>

                  <TimeInput
                    id={`${prefix}-down-time`}
                    label="Down Time"
                    value={value.down_time}
                    onChange={(v) => update({ down_time: v })}
                    optional
                    disabled={isLast && !includeEndDownTime}
                    disabledTitle="Down time excluded on last split (see segment setting)"
                  />

                  <TimeInput
                    id={`${prefix}-adj-time`}
                    label="Adj. Time"
                    value={value.adjustment_time}
                    onChange={(v) => update({ adjustment_time: v })}
                    optional
                    allowNegative
                  />

                  <div className="field field--full-width">
                    <label htmlFor={`${prefix}-tz`}>Split Timezone</label>
                    <TimezoneSelect
                      id={`${prefix}-tz`}
                      value={
                        value.differentTimezone ? value.timezone : courseTz
                      }
                      onChange={(tz) =>
                        update(
                          tz === courseTz
                            ? { differentTimezone: false }
                            : { differentTimezone: true, timezone: tz },
                        )
                      }
                    />
                  </div>
                </div>
              )}

              {/* Rest stop */}
              <RestStopFormComponent
                prefix={`${prefix}-rs`}
                value={value.rest_stop}
                onChange={(rs) => update({ rest_stop: rs })}
                addressLoading={addressLoading}
              />
            </>
          );

          // ── Map content (SplitEndpointMap) ──
          const mapContent = mapAvailable ? (
            <SplitEndpointMap
              gpxTrack={gpxTrack!}
              startKm={gpxProfile!.startKm}
              endKm={gpxProfile!.endKm}
              endLat={gpxProfile!.endLat}
              endLon={gpxProfile!.endLon}
              unitSystem={unitSystem}
              restStop={value.rest_stop}
              onSelectStop={(patch) =>
                update({ rest_stop: { ...value.rest_stop, ...patch } })
              }
              onAddressLoading={setAddressLoading}
            />
          ) : null;

          // ── Select layout shell ──
          if (mapAvailable && layoutState === "both") {
            if (isNarrow) {
              return (
                <div className="split-two-pane split-two-pane--stacked">
                  <div className="split-form-col">{formContent}</div>
                  <div className="split-map-col">{mapContent}</div>
                </div>
              );
            }
            return (
              <div className="split-two-pane">
                <div className="split-form-col" style={{ width: formColWidth }}>
                  {formContent}
                </div>
                <div
                  ref={resizeHandleRef}
                  className="split-resize-handle"
                  onMouseDown={(e) => {
                    isDragging.current = true;
                    dragStartX.current = e.clientX;
                    dragStartWidth.current = formColWidth;
                    resizeHandleRef.current?.classList.add("active");
                    e.preventDefault();
                  }}
                />
                <div className="split-map-col">{mapContent}</div>
              </div>
            );
          }

          if (mapAvailable && layoutState === "map") {
            return (
              <div className="split-two-pane">
                <div className="split-map-col--full">{mapContent}</div>
              </div>
            );
          }

          // "form" or GPX not available — plain split-body (original layout, no map)
          return <div className="split-body">{formContent}</div>;
        })()}
    </div>
  );
}
