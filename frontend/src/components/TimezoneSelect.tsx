import { useMemo } from "react";

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

  return `${short} (${offset}) \u2014 ${tz.replace(/_/g, " ")}`;
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

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tz-select"
    >
      {options.map(({ tz, label }) => (
        <option key={tz} value={tz}>
          {label}
        </option>
      ))}
    </select>
  );
}
