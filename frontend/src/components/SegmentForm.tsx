import { useState } from "react";
import type {
  SegmentForm,
  SplitForm as SplitFormType,
  UnitSystem,
  Mode,
  SplitGpxProfile,
} from "../types";
import { speedLabel, distanceLabel, minutesToHms } from "../utils";
import { makeDefaultSplit } from "../defaults";
import TimeInput from "./TimeInput";
import SplitFormComponent from "./SplitForm";
import { FieldError } from "./FieldError";

interface SegmentFormProps {
  segIndex: number;
  value: SegmentForm;
  onChange: (val: SegmentForm) => void;
  unitSystem: UnitSystem;
  mode: Mode;
  gpxProfiles?: SplitGpxProfile[] | null;
}

export default function SegmentFormComponent({
  segIndex,
  value,
  onChange,
  unitSystem,
  mode,
  gpxProfiles,
}: SegmentFormProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasOptionalValues =
    !!value.down_time_ratio ||
    !!value.split_decay ||
    !!value.moving_speed ||
    !!value.min_moving_speed;
  const [showOptional, setShowOptional] = useState(hasOptionalValues);
  const update = (patch: Partial<SegmentForm>) =>
    onChange({ ...value, ...patch });
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);
  const prefix = `seg${segIndex}`;

  const handleSplitCountChange = (raw: string) => {
    update({ splitCount: raw });
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) {
      const curr = value.splits;
      if (n > curr.length) {
        const extra: SplitFormType[] = Array.from(
          { length: n - curr.length },
          makeDefaultSplit,
        );
        update({ splitCount: raw, splits: [...curr, ...extra] });
      } else if (n < curr.length) {
        update({ splitCount: raw, splits: curr.slice(0, n) });
      }
    }
  };

  const updateSplit = (i: number, split: SplitFormType) => {
    const next = [...value.splits];
    next[i] = split;
    update({ splits: next });
  };

  const totalDist = (() => {
    if (mode === "target_distance") {
      // In target distance mode, distances are markers; total is the last split's distance
      for (let i = value.splits.length - 1; i >= 0; i--) {
        const d = parseFloat(value.splits[i].distance);
        if (!isNaN(d) && d > 0) return d;
      }
      return 0;
    }
    return value.splits.reduce((sum, s) => {
      const d = parseFloat(s.distance);
      return sum + (isNaN(d) ? 0 : d);
    }, 0);
  })();

  const sleepHms = minutesToHms(value.sleep_time);
  const summaryParts: string[] = [
    `${value.splits.length} split${value.splits.length !== 1 ? "s" : ""}`,
  ];
  if (totalDist > 0) summaryParts.push(`${totalDist.toFixed(1)} ${dLabel}`);
  if (sleepHms) summaryParts.push(`💤 ${sleepHms}`);
  const summary = `Segment ${segIndex + 1}: ${summaryParts.join(" · ")}`;

  return (
    <div className="segment-form">
      <div className="segment-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="collapse-icon">{collapsed ? "▶" : "▼"}</span>
        <h3>{summary}</h3>
      </div>

      {!collapsed && (
        <div className="segment-body">
          <div className="fields-grid">
            <TimeInput
              id={`${prefix}-sleep-time`}
              label="Sleep Time"
              value={value.sleep_time}
              onChange={(v) => update({ sleep_time: v })}
            />

            <div className="field">
              <label htmlFor={`${prefix}-split-count`}>Split Count *</label>
              <input
                id={`${prefix}-split-count`}
                type="number"
                min="1"
                step="1"
                value={value.splitCount}
                onChange={(e) => handleSplitCountChange(e.target.value)}
              />
              <FieldError fieldId={`${prefix}-split-count`} />
            </div>

            <div className="field">
              <label>
                <input
                  id={`${prefix}-end-dt`}
                  type="checkbox"
                  checked={value.include_end_down_time}
                  onChange={(e) =>
                    update({ include_end_down_time: e.target.checked })
                  }
                />{" "}
                Include Down Time on Last Split?
              </label>
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
                <label htmlFor={`${prefix}-dtr`}>Down Time Ratio</label>
                <input
                  id={`${prefix}-dtr`}
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={value.down_time_ratio}
                  onChange={(e) => update({ down_time_ratio: e.target.value })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-dtr`} />
              </div>

              <div className="field">
                <label htmlFor={`${prefix}-split-decay`}>
                  Split Decay ({sLabel})
                </label>
                <input
                  id={`${prefix}-split-decay`}
                  type="number"
                  step="any"
                  value={value.split_decay}
                  onChange={(e) => update({ split_decay: e.target.value })}
                  placeholder="Inherits"
                />
              </div>

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

              <div className="field">
                <label htmlFor={`${prefix}-min-speed`}>
                  Min Speed ({sLabel})
                </label>
                <input
                  id={`${prefix}-min-speed`}
                  type="number"
                  step="any"
                  value={value.min_moving_speed}
                  onChange={(e) => update({ min_moving_speed: e.target.value })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-min-speed`} />
              </div>
            </div>
          )}

          <div className="splits-container">
            {value.splits.map((split, j) => (
              <SplitFormComponent
                key={j}
                segIndex={segIndex}
                splitIndex={j}
                value={split}
                onChange={(s) => updateSplit(j, s)}
                unitSystem={unitSystem}
                isLast={j === value.splits.length - 1}
                includeEndDownTime={value.include_end_down_time}
                gpxProfile={gpxProfiles?.[j] ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
