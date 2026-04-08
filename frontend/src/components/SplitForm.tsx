import { useState, useEffect } from "react";
import type { SplitForm, UnitSystem, SplitGpxProfile } from "../types";
import { speedLabel, distanceLabel, minutesToHms } from "../utils";
import TimeInput from "./TimeInput";
import RestStopFormComponent from "./RestStopForm";
import TimezoneSelect from "./TimezoneSelect";
import { FieldError } from "./FieldError";
import NearbyStopsPanel from "./NearbyStopsPanel";

interface SplitFormProps {
  segIndex: number;
  splitIndex: number;
  value: SplitForm;
  onChange: (val: SplitForm) => void;
  unitSystem: UnitSystem;
  isLast?: boolean;
  includeEndDownTime?: boolean;
  gpxProfile?: SplitGpxProfile | null;
  courseTz: string;
}

export default function SplitFormComponent({
  segIndex,
  splitIndex,
  value,
  onChange,
  unitSystem,
  isLast,
  includeEndDownTime,
  gpxProfile,
  courseTz,
}: SplitFormProps) {
  const update = (patch: Partial<SplitForm>) =>
    onChange({ ...value, ...patch });

  const [showNearby, setShowNearby] = useState(false);

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
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);
  const prefix = `seg${segIndex}-split${splitIndex}`;

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    unitSystem === "imperial" ? Math.round(m * 3.28084) : m;

  const summaryParts: string[] = [];
  if (value.distance) summaryParts.push(`${value.distance} ${dLabel}`);
  const downHms = minutesToHms(value.down_time);
  if (downHms) summaryParts.push(`↓${downHms}`);
  const adjHms = minutesToHms(value.adjustment_time);
  if (adjHms) summaryParts.push(`±${adjHms}`);
  const summary = summaryParts.length
    ? summaryParts.join(" · ")
    : "(no distance)";
  const displayName = value.name?.trim() || null;
  const headerTitle = displayName ? displayName : `Split ${splitIndex + 1}`;

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
    <div className="split-form">
      <div className="split-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="collapse-icon-sm">{collapsed ? "▶" : "▼"}</span>
        <span className="split-header-title">{headerTitle}</span>
        {collapsed && <span className="split-header-summary">{summary}</span>}
        <div className="split-header-badges">
          {tzBadgeAbbr && (
            <span
              className="split-tz-badge"
              title={`Split timezone: ${activeTz}`}
            >
              🕐 {tzBadgeAbbr}
            </span>
          )}
          {gpxProfile && (
            <span className="split-header-elev" title="Elevation gain / loss">
              ⬆{toElevUnit(gpxProfile.elevGainM)}
              {elevUnit} ⬇{toElevUnit(gpxProfile.elevLossM)}
              {elevUnit}
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="split-body">
          <div className="field segment-name-field split-name-field">
            <input
              id={`${prefix}-name`}
              type="text"
              placeholder={`Split ${splitIndex + 1} name (optional)`}
              value={value.name ?? ""}
              onChange={(e) => update({ name: e.target.value })}
            />
          </div>
          <div className="fields-grid">
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
          </div>

          <button
            type="button"
            className="optional-toggle"
            onClick={() => setShowOptional(!showOptional)}
          >
            <span className={`chevron${showOptional ? " open" : ""}`}>▶</span>
            Optional overrides
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

              <div className="field">
                <label>
                  <input
                    id={`${prefix}-diff-tz`}
                    type="checkbox"
                    checked={value.differentTimezone}
                    onChange={(e) =>
                      update({ differentTimezone: e.target.checked })
                    }
                  />{" "}
                  Different timezone?
                </label>
              </div>

              {value.differentTimezone && (
                <div className="field">
                  <label htmlFor={`${prefix}-tz`}>Split Timezone</label>
                  <TimezoneSelect
                    id={`${prefix}-tz`}
                    value={value.timezone}
                    onChange={(tz) => update({ timezone: tz })}
                  />
                </div>
              )}
            </div>
          )}

          {/* Sub-split mode — own row since it dynamically adds inputs */}
          <div className="fields-grid">
            <div className="field">
              <label id={`${prefix}-ssm-label`}>Sub-Split Mode</label>
              <div
                className="radio-group"
                role="radiogroup"
                aria-labelledby={`${prefix}-ssm-label`}
              >
                {(["even", "fixed", "custom"] as const).map((m) => (
                  <label key={m}>
                    <input
                      id={`${prefix}-ssm-${m}`}
                      type="radio"
                      name={`sub_split_mode_${segIndex}_${splitIndex}`}
                      value={m}
                      checked={value.sub_split_mode === m}
                      onChange={() => update({ sub_split_mode: m })}
                    />{" "}
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            {value.sub_split_mode === "even" && (
              <div className="field">
                <label htmlFor={`${prefix}-ss-count`}>Sub-Split Count *</label>
                <input
                  id={`${prefix}-ss-count`}
                  type="number"
                  min="1"
                  step="1"
                  value={value.sub_split_count}
                  onChange={(e) => update({ sub_split_count: e.target.value })}
                />
                <FieldError fieldId={`${prefix}-ss-count`} />
              </div>
            )}

            {value.sub_split_mode === "fixed" && (
              <>
                <div className="field">
                  <label htmlFor={`${prefix}-ss-distance`}>
                    Sub-Split Dist ({dLabel}) *
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
                <div className="field">
                  <label htmlFor={`${prefix}-ss-threshold`}>
                    Last Sub-Split Threshold ({dLabel}) *
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
              </>
            )}

            {value.sub_split_mode === "custom" && (
              <div className="field">
                <label htmlFor={`${prefix}-ss-distances`}>
                  Sub-Split Distances (comma-separated) *
                </label>
                <input
                  id={`${prefix}-ss-distances`}
                  type="text"
                  value={value.sub_split_distances}
                  onChange={(e) =>
                    update({ sub_split_distances: e.target.value })
                  }
                  placeholder="e.g. 10, 20, 30, 40"
                />
                <FieldError fieldId={`${prefix}-ss-distances`} />
              </div>
            )}
          </div>

          {/* GPX elevation badges */}
          {gpxProfile && (
            <div className="gpx-badge-row">
              <span className="gpx-badge" title="Elevation gain">
                ⬆ {toElevUnit(gpxProfile.elevGainM)} {elevUnit}
              </span>
              <span className="gpx-badge" title="Elevation loss">
                ⬇ {toElevUnit(gpxProfile.elevLossM)} {elevUnit}
              </span>
              <span className="gpx-badge" title="Average grade">
                ~ {gpxProfile.avgGradePct.toFixed(1)}% avg
              </span>
              <span className="gpx-badge" title="% of distance with grade > 5%">
                🟡 {gpxProfile.steepPct}% steep
              </span>
              {gpxProfile.surface !== "unknown" && (
                <span className="gpx-badge" title="Dominant surface">
                  {gpxProfile.surface}
                </span>
              )}
            </div>
          )}

          {/* OSM endpoint map — shown when GPX is loaded and distance is set */}
          {gpxProfile?.endLat != null && value.distance && (
            <div className="split-map">
              <iframe
                title={`Split ${splitIndex + 1} endpoint`}
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${gpxProfile.endLon - 0.02},${gpxProfile.endLat - 0.015},${gpxProfile.endLon + 0.02},${gpxProfile.endLat + 0.015}&layer=mapnik&marker=${gpxProfile.endLat},${gpxProfile.endLon}`}
                className="split-map-iframe"
                loading="lazy"
              />
              <a
                href={`https://www.openstreetmap.org/?mlat=${gpxProfile.endLat}&mlon=${gpxProfile.endLon}#map=14/${gpxProfile.endLat}/${gpxProfile.endLon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="split-map-link"
              >
                Open in OSM ↗
              </a>
            </div>
          )}
          <RestStopFormComponent
            prefix={`${prefix}-rs`}
            value={value.rest_stop}
            onChange={(rs) => update({ rest_stop: rs })}
          />
          {gpxProfile?.endLat != null && (
            <div className="nearby-stops-section">
              {!showNearby && (
                <button
                  type="button"
                  className="nearby-find-btn"
                  onClick={() => setShowNearby(true)}
                >
                  🔍 Find Nearby Stops
                </button>
              )}
              {showNearby && (
                <NearbyStopsPanel
                  key={`${gpxProfile.endLat},${gpxProfile.endLon}`}
                  lat={gpxProfile.endLat}
                  lon={gpxProfile.endLon}
                  unitSystem={unitSystem}
                  onClose={() => setShowNearby(false)}
                  onSelect={(patch) =>
                    update({
                      rest_stop: { ...value.rest_stop, ...patch },
                    })
                  }
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
