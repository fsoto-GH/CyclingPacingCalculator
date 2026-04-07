import { useState } from "react";
import type { SplitForm, UnitSystem } from "../types";
import { speedLabel, distanceLabel } from "../utils";
import TimeInput from "./TimeInput";
import RestStopFormComponent from "./RestStopForm";
import TimezoneSelect from "./TimezoneSelect";
import { FieldError } from "./FieldError";

interface SplitFormProps {
  segIndex: number;
  splitIndex: number;
  value: SplitForm;
  onChange: (val: SplitForm) => void;
  unitSystem: UnitSystem;
  isLast?: boolean;
  includeEndDownTime?: boolean;
}

export default function SplitFormComponent({
  segIndex,
  splitIndex,
  value,
  onChange,
  unitSystem,
  isLast,
  includeEndDownTime,
}: SplitFormProps) {
  const update = (patch: Partial<SplitForm>) =>
    onChange({ ...value, ...patch });

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

  const summary = value.distance
    ? `${value.distance} ${dLabel}`
    : "(no distance)";

  return (
    <div className="split-form">
      <div className="split-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="collapse-icon-sm">{collapsed ? "▶" : "▼"}</span>
        <span className="split-header-title">Split {splitIndex + 1}</span>
        {collapsed && <span className="split-header-summary">{summary}</span>}
      </div>

      {!collapsed && (
        <div className="split-body">
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

          {/* Rest Stop */}
          <RestStopFormComponent
            prefix={`${prefix}-rs`}
            value={value.rest_stop}
            onChange={(rs) => update({ rest_stop: rs })}
          />
        </div>
      )}
    </div>
  );
}
