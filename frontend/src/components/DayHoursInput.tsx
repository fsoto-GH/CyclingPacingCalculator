import type { DayHoursEntry, DayHoursMode } from "../types";

interface DayHoursInputProps {
  id: string;
  label?: string;
  value: DayHoursEntry;
  onChange: (val: DayHoursEntry) => void;
}

const MODES: { value: DayHoursMode; label: string }[] = [
  { value: "hours", label: "Hours" },
  { value: "24h", label: "24h" },
  { value: "closed", label: "Closed" },
];

/** Returns true if the closing time is on the next calendar day. */
function closesNextDay(opens: string, closes: string): boolean {
  if (!opens || !closes) return false;
  return closes <= opens && closes !== "00:00";
}

export default function DayHoursInput({
  id,
  label,
  value,
  onChange,
}: DayHoursInputProps) {
  const update = (patch: Partial<DayHoursEntry>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="day-hours-input">
      {label && <span className="day-hours-label">{label}</span>}

      <div
        className="pill-group"
        role="group"
        aria-label={label ?? "Hours mode"}
      >
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`pill${value.mode === m.value ? " active" : ""}`}
            onClick={() => update({ mode: m.value })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {value.mode === "hours" && (
        <div className="hours-range">
          <label htmlFor={`${id}-opens`} className="sr-only">
            Opens
          </label>
          <input
            id={`${id}-opens`}
            type="time"
            value={value.opens}
            onChange={(e) => update({ opens: e.target.value })}
          />
          <span className="hours-sep">–</span>
          <label htmlFor={`${id}-closes`} className="sr-only">
            Closes
          </label>
          <input
            id={`${id}-closes`}
            type="time"
            value={value.closes}
            onChange={(e) => update({ closes: e.target.value })}
          />
          {closesNextDay(value.opens, value.closes) && (
            <span
              className="next-day-flag"
              title="Closing time is on the next calendar day"
            >
              ⚑ Closes next day
            </span>
          )}
        </div>
      )}
    </div>
  );
}
