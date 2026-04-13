import { useMemo, useState, useRef, useEffect, useCallback } from "react";

interface TimezoneSelectProps {
  id: string;
  value: string;
  onChange: (tz: string) => void;
}

/** Common IANA timezones. Uses Intl.supportedValuesOf where available. */
const COMMON_TIMEZONES: string[] =
  typeof (Intl as any).supportedValuesOf === "function"
    ? (Intl as any).supportedValuesOf("timeZone")
    : [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Asia/Kolkata",
        "Australia/Sydney",
        "UTC",
      ];

export const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getOffsetLabel(tz: string): string {
  const now = new Date();
  const offset =
    new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";

  const short =
    new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "short",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";

  return `${short} (${offset}) — ${tz.replace(/_/g, " ")}`;
}

export default function TimezoneSelect({
  id,
  value,
  onChange,
}: TimezoneSelectProps) {
  const options = useMemo(
    () => COMMON_TIMEZONES.map((tz) => ({ tz, label: getOffsetLabel(tz) })),
    [],
  );

  const selectedLabel = useMemo(
    () => options.find((o) => o.tz === value)?.label ?? value,
    [options, value],
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.tz.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
        setActiveIdx(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const item = listRef.current.children[activeIdx] as
        | HTMLElement
        | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  const select = useCallback(
    (tz: string) => {
      onChange(tz);
      setOpen(false);
      setQuery("");
      setActiveIdx(-1);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        setOpen(true);
        setActiveIdx(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActiveIdx((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && filtered[activeIdx]) select(filtered[activeIdx].tz);
      e.preventDefault();
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setActiveIdx(-1);
    }
  };

  return (
    <div ref={containerRef} className="tz-combobox" onKeyDown={handleKeyDown}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-activedescendant={
          activeIdx >= 0 ? `${id}-opt-${activeIdx}` : undefined
        }
        className="tz-input"
        value={open ? query : selectedLabel}
        placeholder="Search timezone…"
        onFocus={() => {
          setQuery("");
          setOpen(true);
          setActiveIdx(-1);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIdx(0);
        }}
      />
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="tz-dropdown"
        >
          {filtered.length === 0 && (
            <li className="tz-no-results">No matches</li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o.tz}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.tz === value}
              className={`tz-option${o.tz === value ? " tz-option-selected" : ""}${i === activeIdx ? " tz-option-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before click
                select(o.tz);
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
