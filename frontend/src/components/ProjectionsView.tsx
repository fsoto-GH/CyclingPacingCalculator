import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  CourseForm as CourseFormState,
  CourseDetail,
  DayHoursEntry,
  GpxTrackPoint,
  SegmentDetail,
  SegmentForm,
  SplitDetail,
  SplitGpxProfile,
  SubSplitDetail,
  UnitSystem,
} from "../types";
import {
  SEGMENT_COLORS,
  distanceLabel,
  formatHours,
  minutesToHms,
  speedLabel,
} from "../utils";

const SplitEndpointMap = lazy(() => import("./SplitEndpointMap"));

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

interface EtaInfo {
  status: "open" | "near-open" | "near-close" | "closed";
  statusWord: string;
  hoursLabel: string;
  nearDetail: string | null;
}

function checkArrivalVsHours(
  arrivalIso: string,
  entry: DayHoursEntry,
  tz: string,
  marginOpen = 15,
  marginClose = 7,
): "open" | "closed" | "near-open" | "near-close" | null {
  if (entry.mode === "24h") return "open";
  if (entry.mode === "closed") return "closed";

  const arrival = new Date(arrivalIso);
  const arrivalStr = arrival.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const arrMin = timeToMin(arrivalStr);
  const openMin = timeToMin(entry.opens);
  const closeMin = timeToMin(entry.closes);

  const dOpen = Math.min(
    (arrMin - openMin + 1440) % 1440,
    (openMin - arrMin + 1440) % 1440,
  );
  const dClose = Math.min(
    (arrMin - closeMin + 1440) % 1440,
    (closeMin - arrMin + 1440) % 1440,
  );

  if (dClose <= marginClose) return "near-close";
  if (dOpen <= marginOpen) return "near-open";

  if (closeMin > openMin) {
    return arrMin >= openMin && arrMin <= closeMin ? "open" : "closed";
  }
  return arrMin >= openMin || arrMin <= closeMin ? "open" : "closed";
}

function fmt12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

function buildEtaInfo(
  splitResult: SplitDetail,
  formSplit: SegmentForm["splits"][number],
  courseTz: string,
  etaMarginOpen: number,
  etaMarginClose: number,
): EtaInfo | null {
  if (!formSplit.rest_stop.enabled) return null;

  const rs = formSplit.rest_stop;
  const splitEndTz =
    splitResult.end_timezone ||
    (formSplit.differentTimezone && formSplit.timezone
      ? formSplit.timezone
      : null);
  const tz = splitEndTz ?? courseTz;

  const arrival = new Date(splitResult.end_time);
  const dayName = arrival.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  const dayMap: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  const dayIdx = dayMap[dayName] ?? 0;
  const entry: DayHoursEntry = rs.sameHoursEveryDay
    ? rs.allDays
    : rs.perDay[dayIdx];

  const status = checkArrivalVsHours(
    splitResult.end_time,
    entry,
    tz,
    etaMarginOpen,
    etaMarginClose,
  );
  if (!status) return null;

  let hoursLabel: string;
  if (entry.mode === "24h") hoursLabel = "24 hours";
  else if (entry.mode === "closed") hoursLabel = "Closed";
  else hoursLabel = `${fmt12h(entry.opens)} – ${fmt12h(entry.closes)}`;

  let nearDetail: string | null = null;
  if (
    (status === "near-open" || status === "near-close") &&
    entry.mode === "hours"
  ) {
    const arrivalStr = arrival.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const arrMin = timeToMin(arrivalStr);
    const openMin = timeToMin(entry.opens);
    const closeMin = timeToMin(entry.closes);

    if (status === "near-open") {
      const minsAfterOpen = (arrMin - openMin + 1440) % 1440;
      const minsBeforeOpen = (openMin - arrMin + 1440) % 1440;
      if (minsAfterOpen <= minsBeforeOpen) {
        nearDetail =
          minsAfterOpen === 0
            ? "Arriving exactly at opening"
            : minsAfterOpen === 1
              ? "1 min after opening"
              : `${minsAfterOpen} min after opening`;
      } else {
        nearDetail =
          minsBeforeOpen === 1
            ? "1 min before opening"
            : `${minsBeforeOpen} min before opening`;
      }
    } else {
      const minsBeforeClose = (closeMin - arrMin + 1440) % 1440;
      const minsAfterClose = (arrMin - closeMin + 1440) % 1440;
      if (minsBeforeClose <= minsAfterClose) {
        nearDetail =
          minsBeforeClose === 0
            ? "Arriving exactly at closing"
            : minsBeforeClose === 1
              ? "1 min before closing"
              : `${minsBeforeClose} min before closing`;
      } else {
        nearDetail =
          minsAfterClose === 1
            ? "1 min after closing"
            : `${minsAfterClose} min after closing`;
      }
    }
  }

  const statusWords: Record<string, string> = {
    open: "Open",
    "near-open": "Near open",
    "near-close": "Near close",
    closed: "Closed",
  };

  return { status, statusWord: statusWords[status], hoursLabel, nearDetail };
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

function fmtInTz(iso: string, tz: string): string {
  return new Date(iso).toLocaleString(undefined, {
    ...DATE_OPTS,
    timeZone: tz,
    timeZoneName: "short",
  });
}

interface ProjectionsViewProps {
  result: CourseDetail | null;
  form: CourseFormState;
  unitSystem: UnitSystem;
  courseTz: string;
  courseStartCity?: string | null;
  segmentIndexes?: number[];
  collapseSignal?: number;
  expandAllSignal?: number;
  gpxTrack?: GpxTrackPoint[] | null;
  cityLabels?: (string | null)[][];
  gpxProfiles?: SplitGpxProfile[][] | null;
  splitCumulativeDists?: (number | null)[][] | null;
  gpxTotalDist?: number | null;
  etaMarginOpen?: number;
  etaMarginClose?: number;
}

export default function ProjectionsView({
  result,
  form,
  unitSystem,
  courseTz,
  courseStartCity,
  segmentIndexes,
  collapseSignal = 0,
  expandAllSignal = 0,
  gpxTrack,
  cityLabels,
  gpxProfiles,
  splitCumulativeDists,
  gpxTotalDist,
  etaMarginOpen = 15,
  etaMarginClose = 7,
}: ProjectionsViewProps) {
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);
  const indices =
    segmentIndexes ?? result?.segment_details.map((_, idx) => idx) ?? [];

  if (!result) {
    return (
      <div className="projections-empty">
        <i className="fas fa-calculator" />
        <p>
          No results yet. Fill in your course in the Planning tab to see
          projections.
        </p>
      </div>
    );
  }

  return (
    <div className="projections-view">
      {indices.map((segIndex) => {
        const segment = result.segment_details[segIndex];
        if (!segment) return null;
        return (
          <ProjectionSegment
            key={segIndex}
            segment={segment}
            segIndex={segIndex}
            formSegment={form.segments[segIndex]}
            unitSystem={unitSystem}
            sLabel={sLabel}
            dLabel={dLabel}
            courseTz={courseTz}
            segmentStartCity={
              segIndex === 0
                ? (courseStartCity ?? null)
                : (cityLabels?.[segIndex - 1]?.[
                    (form.segments[segIndex - 1]?.splits.length ?? 1) - 1
                  ] ?? null)
            }
            collapseSignal={collapseSignal}
            expandAllSignal={expandAllSignal}
            gpxTrack={gpxTrack ?? null}
            cityLabels={cityLabels?.[segIndex] ?? []}
            gpxProfiles={gpxProfiles?.[segIndex] ?? null}
            splitCumulativeDists={splitCumulativeDists?.[segIndex] ?? null}
            segmentStartDist={
              segIndex === 0
                ? 0
                : (splitCumulativeDists?.[segIndex - 1]?.[
                    (form.segments[segIndex - 1]?.splits.length ?? 1) - 1
                  ] ?? null)
            }
            gpxTotalDist={gpxTotalDist ?? null}
            etaMarginOpen={etaMarginOpen}
            etaMarginClose={etaMarginClose}
          />
        );
      })}
    </div>
  );
}

function ProjectionSegment({
  segment,
  segIndex,
  formSegment,
  unitSystem,
  sLabel,
  dLabel,
  courseTz,
  segmentStartCity,
  collapseSignal,
  expandAllSignal,
  gpxTrack,
  cityLabels,
  gpxProfiles,
  splitCumulativeDists,
  segmentStartDist,
  gpxTotalDist,
  etaMarginOpen,
  etaMarginClose,
}: {
  segment: SegmentDetail;
  segIndex: number;
  formSegment: SegmentForm | undefined;
  unitSystem: UnitSystem;
  sLabel: string;
  dLabel: string;
  courseTz: string;
  segmentStartCity: string | null;
  collapseSignal: number;
  expandAllSignal: number;
  gpxTrack: GpxTrackPoint[] | null;
  cityLabels: (string | null)[];
  gpxProfiles: SplitGpxProfile[] | null;
  splitCumulativeDists: (number | null)[] | null;
  segmentStartDist: number | null;
  gpxTotalDist: number | null;
  etaMarginOpen: number;
  etaMarginClose: number;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showResultsGrid, setShowResultsGrid] = useState(false);
  const prevCollapseSignalRef = useRef(collapseSignal);
  const prevExpandAllSignalRef = useRef(expandAllSignal);
  const segColor = SEGMENT_COLORS[segIndex % SEGMENT_COLORS.length];

  useEffect(() => {
    if (collapseSignal === prevCollapseSignalRef.current) return;
    prevCollapseSignalRef.current = collapseSignal;
    if (!collapseSignal) return;
    setCollapsed(true);
  }, [collapseSignal]);

  useEffect(() => {
    if (expandAllSignal === prevExpandAllSignalRef.current) return;
    prevExpandAllSignalRef.current = expandAllSignal;
    if (!expandAllSignal) return;
    setCollapsed(false);
  }, [expandAllSignal]);

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    (unitSystem === "imperial"
      ? Math.round(m * 3.28084)
      : Math.round(m)
    ).toLocaleString();

  const validProfiles = (gpxProfiles ?? []).filter(
    (p): p is SplitGpxProfile => p != null,
  );

  const aggGpx =
    validProfiles.length > 0
      ? (() => {
          const elevGainM = validProfiles.reduce(
            (sum, p) => sum + p.elevGainM,
            0,
          );
          const elevLossM = validProfiles.reduce(
            (sum, p) => sum + p.elevLossM,
            0,
          );
          const totalDistKm =
            validProfiles[validProfiles.length - 1].endKm -
            validProfiles[0].startKm;
          const avgGradePct =
            totalDistKm > 0
              ? ((elevGainM - elevLossM) / (totalDistKm * 1000)) * 100
              : 0;
          const totalSteepKm = validProfiles.reduce((sum, p) => {
            const splitDistKm = p.endKm - p.startKm;
            return sum + (p.steepPct / 100) * splitDistKm;
          }, 0);
          const steepPct =
            totalDistKm > 0
              ? Math.round((totalSteepKm / totalDistKm) * 100)
              : 0;
          return {
            elevGainM: Math.round(elevGainM),
            elevLossM: Math.round(elevLossM),
            avgGradePct,
            steepPct,
          };
        })()
      : null;

  const segCumulativeDist = splitCumulativeDists
    ? splitCumulativeDists[Math.max(0, (formSegment?.splits.length ?? 1) - 1)]
    : null;

  const courseTzAbbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: courseTz,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? courseTz;

  const segTzSequence = useMemo(() => {
    if (!formSegment) return [] as { tz: string; abbr: string }[];

    const sequence: { tz: string; abbr: string }[] = [];
    let prevAbbr: string | null = null;

    formSegment.splits.forEach((split, splitIdx) => {
      let tz: string;
      if (split.tzManuallySet) {
        tz =
          split.differentTimezone && split.timezone ? split.timezone : courseTz;
      } else {
        const detectedTz = gpxProfiles?.[splitIdx]?.endTimezone ?? null;
        tz = detectedTz && detectedTz !== courseTz ? detectedTz : courseTz;
      }

      const abbr =
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          timeZoneName: "short",
        })
          .formatToParts(new Date())
          .find((p) => p.type === "timeZoneName")?.value ?? tz;

      if (abbr !== prevAbbr) {
        sequence.push({ tz, abbr });
        prevAbbr = abbr;
      }
    });

    if (sequence.length > 0 && sequence[0].abbr === courseTzAbbr) {
      return sequence.slice(1);
    }
    return sequence;
  }, [courseTz, courseTzAbbr, formSegment, gpxProfiles]);

  const title =
    segment.name ?? formSegment?.name?.trim() ?? `Segment ${segIndex + 1}`;
  const sleepHms = formSegment ? minutesToHms(formSegment.sleep_time) : "";
  const lastSplitIdx = segment.split_details.length - 1;
  const segEndCity = cityLabels[lastSplitIdx] ?? null;
  const firstSplitResult = segment.split_details[0];
  const lastSplitResult =
    segment.split_details[segment.split_details.length - 1];
  const lastFormSplit = formSegment?.splits[formSegment.splits.length - 1];
  const segmentStartTz = firstSplitResult?.start_timezone || null;
  const segmentEndTz =
    lastSplitResult?.end_timezone ||
    (lastFormSplit?.differentTimezone && lastFormSplit.timezone
      ? lastFormSplit.timezone
      : null);
  const nextStartTime =
    segment.sleep_time_hours > 0
      ? new Date(
          new Date(segment.end_time).getTime() +
            segment.sleep_time_hours * 60 * 60 * 1000,
        ).toISOString()
      : null;
  const citySummary =
    segmentStartCity && segEndCity
      ? `${segmentStartCity} — ${segEndCity}`
      : (segEndCity ?? segmentStartCity ?? null);
  const adjustmentHours = segment.adjustment_time_hours ?? 0;
  const fmtRawHours = (hours: number) => `${hours.toFixed(1)}h`;
  const rawRatio = (numerator: number, denominator: number) =>
    `${fmtRawHours(numerator)} / ${fmtRawHours(denominator)}`;
  const rawDualRatio = (
    numerator: number,
    activeDenominator: number,
    elapsedDenominator: number,
  ) =>
    `${rawRatio(numerator, activeDenominator)} (${rawRatio(numerator, elapsedDenominator)})`;
  const ratioPct = (numerator: number, denominator: number) =>
    denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "-";

  return (
    <div className="segment-form">
      <div
        className="segment-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <span className="collapse-icon" style={{ color: segColor }}>
          {collapsed ? (
            <i className="fas fa-chevron-right" />
          ) : (
            <i className="fas fa-chevron-down" />
          )}
        </span>

        <div className="proj-segment-header-grid">
          <div className="split-header-left proj-segment-header-title">
            <div className="split-header-titlerow">
              <span className="split-header-title">{title}</span>
            </div>
          </div>

          {(segTzSequence.length > 0 || segCumulativeDist != null) && (
            <div className="proj-segment-header-topright">
              <div className="split-header-dist-row">
                {segTzSequence.map(({ tz, abbr }, idx) => (
                  <span
                    key={`${tz}-${idx}`}
                    className="split-header-meta-item split-header-meta-item--tz"
                    title={`Timezone: ${tz}`}
                  >
                    <i className="fa-solid fa-clock-rotate-left"></i> {abbr}
                  </span>
                ))}
                {segCumulativeDist != null && (
                  <>
                    <span className="split-header-dist">
                      {segCumulativeDist.toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{" "}
                      {dLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {aggGpx && (
            <div className="split-header-meta proj-segment-header-metrics">
              <span
                className="split-header-meta-item split-header-meta-item--dist"
                title="Segment distance"
              >
                {segment.distance.toLocaleString(undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}{" "}
                {dLabel}
              </span>
              <span
                className="split-header-meta-item split-header-meta-item--gain"
                title="Elevation gain"
              >
                <i className="fas fa-arrow-up" /> {toElevUnit(aggGpx.elevGainM)}
                {elevUnit}
              </span>
              <span
                className="split-header-meta-item split-header-meta-item--loss"
                title="Elevation loss"
              >
                <i className="fas fa-arrow-down" />{" "}
                {toElevUnit(aggGpx.elevLossM)}
                {elevUnit}
              </span>
              <span
                className="split-header-meta-item split-header-meta-item--grade"
                title="Average grade"
              >
                {aggGpx.avgGradePct.toFixed(1)}% avg
              </span>
              {aggGpx.steepPct > 0 && (
                <span
                  className="split-header-meta-item split-header-meta-item--steep"
                  title="% of distance with grade > 5%"
                >
                  <i className="fa-solid fa-triangle-exclamation"></i>{" "}
                  {aggGpx.steepPct}% steep
                </span>
              )}
            </div>
          )}

          <div className="proj-segment-header-timing split-header-city">
            <span className="proj-city-duration">
              {formatHours(segment.elapsed_time_hours)}
            </span>
            <span className="proj-city-sep"> · </span>
            <span className="proj-city-pace">
              {segment.pace.toFixed(2)} {sLabel}
            </span>
          </div>

          {(citySummary || sleepHms) && (
            <div className="proj-segment-header-location split-header-city">
              {citySummary && (
                <span className="proj-segment-city">{citySummary}</span>
              )}
              {citySummary && sleepHms && (
                <span className="proj-city-sep"> · </span>
              )}
              {sleepHms && (
                <span className="proj-segment-sleep">
                  {sleepHms} <i className="fa-solid fa-moon"></i>
                </span>
              )}
            </div>
          )}

          <div className="proj-segment-header-startend split-header-city">
            <span className="proj-city-start">
              {fmtInTz(segment.start_time, segmentStartTz ?? courseTz)}
            </span>
            <span className="proj-city-sep"> &mdash; </span>
            <span className="proj-city-end">
              {fmtInTz(segment.end_time, segmentEndTz ?? courseTz)}
            </span>
          </div>
        </div>
      </div>

      {!collapsed && (
        <div className="segment-body">
          <button
            type="button"
            className="optional-toggle"
            onClick={() => setShowResultsGrid((v) => !v)}
          >
            <span className={`chevron${showResultsGrid ? " open" : ""}`}>
              ▶
            </span>
            View detailed projections
          </button>

          {showResultsGrid && (
            <div className="split-results-panel">
              <dl className="split-results-grid">
                <div>
                  <dt title="Segment start time">Start</dt>
                  <dd>
                    {fmtInTz(segment.start_time, segmentStartTz ?? courseTz)}
                    {segmentStartTz && segmentStartTz !== courseTz && (
                      <span className="split-end-tz">
                        {fmtInTz(segment.start_time, courseTz)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt title="Segment end time before scheduled sleep">
                    Ride End
                  </dt>
                  <dd>
                    {fmtInTz(segment.end_time, segmentEndTz ?? courseTz)}
                    {segmentEndTz && segmentEndTz !== courseTz && (
                      <span className="split-end-tz">
                        {fmtInTz(segment.end_time, courseTz)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt title="Segment end time plus scheduled sleep time">
                    Wake-up Time
                  </dt>
                  <dd>
                    {nextStartTime
                      ? fmtInTz(nextStartTime, segmentEndTz ?? courseTz)
                      : "-"}
                    {nextStartTime &&
                      segmentEndTz &&
                      segmentEndTz !== courseTz && (
                        <span className="split-end-tz">
                          {fmtInTz(nextStartTime, courseTz)}
                        </span>
                      )}
                  </dd>
                </div>
                <div>
                  <dt title="Total segment distance">Distance</dt>
                  <dd>
                    {segment.distance.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{" "}
                    {dLabel}
                  </dd>
                </div>
                <div>
                  <dt title="Total elapsed time">Elapsed</dt>
                  <dd title={formatHours(segment.elapsed_time_hours, "full")}>
                    {formatHours(segment.elapsed_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Time spent actively riding or moving">Active</dt>
                  <dd title={formatHours(segment.active_time_hours, "full")}>
                    {formatHours(segment.active_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Time spent moving (excludes down time)">Moving</dt>
                  <dd title={formatHours(segment.moving_time_hours, "full")}>
                    {formatHours(segment.moving_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Time stopped or inactive">Down</dt>
                  <dd title={formatHours(segment.down_time_hours, "full")}>
                    {formatHours(segment.down_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Sleep time in this segment">Sleep</dt>
                  <dd title={formatHours(segment.sleep_time_hours, "full")}>
                    {formatHours(segment.sleep_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Average moving speed across the segment">Speed</dt>
                  <dd>
                    {segment.moving_time_hours > 0
                      ? (segment.distance / segment.moving_time_hours).toFixed(
                          2,
                        )
                      : "0.00"}{" "}
                    {sLabel}
                  </dd>
                </div>
                <div>
                  <dt title="Average pace for the segment">Pace</dt>
                  <dd>
                    {segment.pace.toFixed(2)} {sLabel}
                  </dd>
                </div>
                <div>
                  <dt title="Adjustment ratio: active first, segment elapsed in parentheses">
                    Adj Ratio
                  </dt>
                  <dd
                    className="proj-segment-ratio-value"
                    title={rawDualRatio(
                      adjustmentHours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {ratioPct(adjustmentHours, segment.active_time_hours)} (
                    {ratioPct(adjustmentHours, segment.elapsed_time_hours)})
                  </dd>
                </div>
                <div>
                  <dt title="Down-time ratio: active first, segment elapsed in parentheses">
                    Down Ratio
                  </dt>
                  <dd
                    className="proj-segment-ratio-value"
                    title={rawDualRatio(
                      segment.down_time_hours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {ratioPct(
                      segment.down_time_hours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {ratioPct(
                      segment.down_time_hours,
                      segment.elapsed_time_hours,
                    )}
                    )
                  </dd>
                </div>
                <div>
                  <dt title="Moving-time ratio: active first, segment elapsed in parentheses">
                    Moving Ratio
                  </dt>
                  <dd
                    className="proj-segment-ratio-value"
                    title={rawDualRatio(
                      segment.moving_time_hours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {ratioPct(
                      segment.moving_time_hours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {ratioPct(
                      segment.moving_time_hours,
                      segment.elapsed_time_hours,
                    )}
                    )
                  </dd>
                </div>
                <div>
                  <dt title="Sleep-time ratio: active first, segment elapsed in parentheses">
                    Sleep Ratio
                  </dt>
                  <dd
                    className="proj-segment-ratio-value"
                    title={rawDualRatio(
                      segment.sleep_time_hours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {ratioPct(
                      segment.sleep_time_hours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {ratioPct(
                      segment.sleep_time_hours,
                      segment.elapsed_time_hours,
                    )}
                    )
                  </dd>
                </div>
                <div>
                  <dt title="Down time divided by moving time, with segment elapsed time in parentheses">
                    Down / Moving
                  </dt>
                  <dd
                    className="proj-segment-ratio-value"
                    title={rawDualRatio(
                      segment.down_time_hours,
                      segment.moving_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {ratioPct(
                      segment.down_time_hours,
                      segment.moving_time_hours,
                    )}{" "}
                    (
                    {ratioPct(
                      segment.down_time_hours,
                      segment.elapsed_time_hours,
                    )}
                    )
                  </dd>
                </div>
              </dl>
            </div>
          )}

          <div
            className="splits-container"
            style={{ borderLeftColor: `${segColor}33` }}
          >
            {segment.split_details.map((split, splitIndex) => (
              <ProjectionSplit
                key={splitIndex}
                split={split}
                splitIndex={splitIndex}
                formSplit={formSegment?.splits[splitIndex]}
                profile={gpxProfiles?.[splitIndex] ?? null}
                courseTz={courseTz}
                dLabel={dLabel}
                sLabel={sLabel}
                unitSystem={unitSystem}
                gpxTrack={gpxTrack}
                cumulativeDist={splitCumulativeDists?.[splitIndex] ?? null}
                prevCumulativeDist={
                  splitIndex === 0
                    ? (segmentStartDist ?? 0)
                    : (splitCumulativeDists?.[splitIndex - 1] ?? 0)
                }
                gpxTotalDist={gpxTotalDist}
                nearbyCity={cityLabels[splitIndex] ?? null}
                etaMarginOpen={etaMarginOpen}
                etaMarginClose={etaMarginClose}
                segColor={segColor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectionSplit({
  split,
  splitIndex,
  formSplit,
  profile,
  courseTz,
  dLabel,
  sLabel,
  unitSystem,
  gpxTrack,
  cumulativeDist,
  prevCumulativeDist,
  gpxTotalDist,
  nearbyCity,
  etaMarginOpen,
  etaMarginClose,
  segColor,
}: {
  split: SplitDetail;
  splitIndex: number;
  formSplit: SegmentForm["splits"][number] | undefined;
  profile: SplitGpxProfile | null;
  courseTz: string;
  dLabel: string;
  sLabel: string;
  unitSystem: UnitSystem;
  gpxTrack: GpxTrackPoint[] | null;
  cumulativeDist: number | null;
  prevCumulativeDist: number | null;
  gpxTotalDist: number | null;
  nearbyCity: string | null;
  etaMarginOpen: number;
  etaMarginClose: number;
  segColor: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showResultsGrid, setShowResultsGrid] = useState(false);

  const splitStartTz = split.start_timezone || null;
  const splitEndTz =
    split.end_timezone ||
    (formSplit?.differentTimezone && formSplit.timezone
      ? formSplit.timezone
      : null);

  const effectiveTz =
    formSplit?.differentTimezone && formSplit.timezone
      ? formSplit.timezone
      : profile?.endTimezone && profile.endTimezone !== courseTz
        ? profile.endTimezone
        : null;

  const tzBadgeAbbr = effectiveTz
    ? (new Intl.DateTimeFormat("en-US", {
        timeZone: effectiveTz,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? effectiveTz)
    : null;

  const etaInfo =
    formSplit != null
      ? buildEtaInfo(split, formSplit, courseTz, etaMarginOpen, etaMarginClose)
      : null;

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    (unitSystem === "imperial"
      ? Math.round(m * 3.28084)
      : Math.round(m)
    ).toLocaleString();

  const splitDistUser =
    cumulativeDist != null && prevCumulativeDist != null
      ? Math.round((cumulativeDist - prevCumulativeDist) * 10) / 10
      : split.distance;

  const hasDist = cumulativeDist != null && gpxTotalDist != null;
  const diff = hasDist ? cumulativeDist - gpxTotalDist : 0;
  const absDiff = Math.abs(diff);
  const sign = !hasDist
    ? null
    : diff > 0.05
      ? "over"
      : diff < -0.05
        ? "under"
        : "exact";
  const distColor =
    !hasDist || sign == null
      ? undefined
      : sign === "exact"
        ? "#4ade80"
        : sign === "over"
          ? "#f87171"
          : undefined;

  const splitTimeHours = split.moving_time_hours + split.down_time_hours;
  const name =
    split.name?.trim() || formSplit?.name?.trim() || `Split ${splitIndex + 1}`;
  const mapAvailable = !!gpxTrack && !!profile;

  return (
    <div className="split-form">
      <div
        className="split-header"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <span className="collapse-icon-sm" style={{ color: segColor }}>
          {collapsed ? (
            <i className="fas fa-chevron-right" />
          ) : (
            <i className="fas fa-chevron-down" />
          )}
        </span>

        <div className="proj-split-header-grid">
          {/* (0,0) title + meta */}
          <div className="split-header-left proj-split-header-main">
            <div className="split-header-titlerow">
              <span className="split-header-title">{name}</span>
            </div>
            {(profile || splitDistUser != null) && (
              <div className="split-header-meta">
                <span
                  className="split-header-meta-item split-header-meta-item--dist"
                  title="Split distance"
                >
                  {splitDistUser.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{" "}
                  {dLabel}
                </span>
                {profile && (
                  <>
                    <span
                      className="split-header-meta-item split-header-meta-item--gain"
                      title="Elevation gain"
                    >
                      <i className="fas fa-arrow-up" />{" "}
                      {toElevUnit(profile.elevGainM)}
                      {elevUnit}
                    </span>
                    <span
                      className="split-header-meta-item split-header-meta-item--loss"
                      title="Elevation loss"
                    >
                      <i className="fas fa-arrow-down" />{" "}
                      {toElevUnit(profile.elevLossM)}
                      {elevUnit}
                    </span>
                    <span
                      className="split-header-meta-item split-header-meta-item--grade"
                      title="Average grade"
                    >
                      {profile.avgGradePct.toFixed(1)}% avg
                    </span>
                    {profile.steepPct > 0 && (
                      <span
                        className="split-header-meta-item split-header-meta-item--steep"
                        title="% of distance with grade > 5%"
                      >
                        <i className="fa-solid fa-triangle-exclamation"></i>{" "}
                        {profile.steepPct}% steep
                      </span>
                    )}
                    {profile.surface !== "unknown" && (
                      <span
                        className="split-header-meta-item split-header-meta-item--surface"
                        title="Dominant surface"
                      >
                        {profile.surface}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* (1,0) tz/cumul dist + duration · pace */}
          <div className="proj-split-header-topright">
            <div className="split-header-dist-row">
              {tzBadgeAbbr && (
                <span className="split-header-meta-item split-header-meta-item--tz">
                  <i className="fa-solid fa-clock-rotate-left"></i>{" "}
                  {tzBadgeAbbr}
                </span>
              )}
            </div>
            <div className="split-header-city">
              {hasDist && (
                <>
                  <span
                    className="split-header-dist"
                    style={{ color: distColor }}
                  >
                    {cumulativeDist!.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{" "}
                    {dLabel}
                  </span>
                  <span className="proj-city-sep"> · </span>
                </>
              )}
              <span className="proj-city-duration">
                {formatHours(splitTimeHours)}
              </span>
              <span className="proj-city-sep"> · </span>
              <span className="proj-city-pace">
                {split.pace.toFixed(2)} {sLabel}
              </span>
            </div>
          </div>

          {/* (0,1) start → end time */}
          <div className="proj-split-header-startend split-header-city">
            <span className="proj-city-start">
              {fmtInTz(split.start_time, splitStartTz ?? courseTz)}
            </span>
            <span className="proj-city-sep"> &mdash; </span>
            <span className="proj-city-end">
              {fmtInTz(split.end_time, splitEndTz ?? courseTz)}
            </span>
          </div>

          {/* (1,1) eta-badge · city · GPX state */}
          <div className="proj-split-header-status split-header-city">
            {etaInfo && (
              <span
                className={`eta-badge eta-${etaInfo.status}`}
                title={`${etaInfo.statusWord} (${etaInfo.nearDetail ? etaInfo.nearDetail : etaInfo.hoursLabel})`}
              >
                {etaInfo.status === "open" &&
                  (etaInfo.hoursLabel === "24 hours" ? "24/7" : "Open")}
                {etaInfo.status === "near-open" && "Near open"}
                {etaInfo.status === "near-close" && "Near close"}
                {etaInfo.status === "closed" && "Closed"}
              </span>
            )}
            {nearbyCity && (
              <span className="proj-segment-city">{nearbyCity}</span>
            )}
            {sign != null && sign !== "exact" && (
              <span style={{ color: distColor }}>
                {sign === "under"
                  ? `${absDiff.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel} left`
                  : `${absDiff.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel} over`}
              </span>
            )}
            {sign === "exact" && (
              <span style={{ color: "#4ade80" }}>✓ matches GPX</span>
            )}
          </div>
        </div>
      </div>

      {!collapsed && (
        <div className="split-results-panel">
          <button
            type="button"
            className="optional-toggle"
            onClick={() => setShowResultsGrid((v) => !v)}
          >
            <span className={`chevron${showResultsGrid ? " open" : ""}`}>
              ▶
            </span>
            View detailed projections
          </button>

          {showResultsGrid && (
            <dl className="split-results-grid proj-split-results-grid">
              <div>
                <dt title="Split start time">Start</dt>
                <dd>
                  {fmtInTz(split.start_time, splitStartTz ?? courseTz)}
                  {splitStartTz && splitStartTz !== courseTz && (
                    <span className="split-end-tz">
                      {" "}
                      {fmtInTz(split.start_time, courseTz)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt title="Split end time (arrival at rest stop or next split)">
                  End
                </dt>
                <dd>
                  {fmtInTz(split.end_time, splitEndTz ?? courseTz)}
                  {splitEndTz && splitEndTz !== courseTz && (
                    <span className="split-end-tz">
                      {" "}
                      {fmtInTz(split.end_time, courseTz)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt title="Time spent actively riding or moving">Active</dt>
                <dd title={formatHours(split.active_time_hours, "full")}>
                  {formatHours(split.active_time_hours)}
                </dd>
              </div>
              <div>
                <dt title="Time spent moving (excludes down time)">Moving</dt>
                <dd title={formatHours(split.moving_time_hours, "full")}>
                  {formatHours(split.moving_time_hours)}
                </dd>
              </div>
              <div>
                <dt title="Time stopped or inactive">Down</dt>
                <dd title={formatHours(split.down_time_hours, "full")}>
                  {formatHours(split.down_time_hours)}
                </dd>
              </div>
              <div>
                <dt title="Moving time + down time">Split Time</dt>
                <dd title={formatHours(splitTimeHours, "full")}>
                  {formatHours(splitTimeHours)}
                </dd>
              </div>
              <div>
                <dt title="Average moving speed across this split">Speed</dt>
                <dd>
                  {split.moving_speed.toFixed(2)} {sLabel}
                </dd>
              </div>
              <div>
                <dt title="Average pace across this split">Pace</dt>
                <dd>
                  {split.pace.toFixed(2)} {sLabel}
                </dd>
              </div>
              {split.adjustment_time_hours != null &&
                split.adjustment_time_hours !== 0 && (
                  <div>
                    <dt title="Manual time adjustment applied to this split">
                      Adj. Time
                    </dt>
                    <dd
                      title={formatHours(split.adjustment_time_hours, "full")}
                    >
                      {formatHours(split.adjustment_time_hours)}
                    </dd>
                  </div>
                )}
              {etaInfo && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <dt title="Hours for the rest stop at the estimated time of arrival.">
                    Rest Stop Hours
                  </dt>
                  <dd>
                    <span>{etaInfo.hoursLabel}</span>
                    {etaInfo.nearDetail && (
                      <span className="split-results-near-detail">
                        {etaInfo.nearDetail}
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}

          {formSplit?.rest_stop.enabled &&
            (formSplit.rest_stop.name ||
              formSplit.rest_stop.address ||
              formSplit.rest_stop.alt ||
              formSplit.notes) && (
              <div className="split-results-rs-info">
                {formSplit.rest_stop.name && (
                  <div className="split-results-rs-name">
                    {formSplit.rest_stop.alt ? (
                      <a
                        href={formSplit.rest_stop.alt}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {formSplit.rest_stop.name}
                      </a>
                    ) : (
                      formSplit.rest_stop.name
                    )}
                  </div>
                )}
                {formSplit.rest_stop.address && (
                  <div className="split-results-rs-address">
                    {formSplit.rest_stop.address}
                  </div>
                )}
                {!formSplit.rest_stop.name && formSplit.rest_stop.alt && (
                  <div className="split-results-rs-address">
                    <a
                      href={formSplit.rest_stop.alt}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {formSplit.rest_stop.alt}
                    </a>
                  </div>
                )}
                {formSplit.notes && (
                  <div className="split-results-rs-notes">
                    {formSplit.notes}
                  </div>
                )}
              </div>
            )}

          {split.sub_splits.length > 0 && (
            <details className="split-sub-splits">
              <summary>Sub-splits ({split.sub_splits.length})</summary>
              <table className="split-sub-splits-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Dist</th>
                    <th>Moving</th>
                    <th>Down</th>
                  </tr>
                </thead>
                <tbody>
                  {split.sub_splits.map((ss: SubSplitDetail, i: number) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        {ss.distance.toLocaleString(undefined, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}{" "}
                        {dLabel}
                      </td>
                      <td>{formatHours(ss.moving_time_hours)}</td>
                      <td>{formatHours(ss.down_time_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {mapAvailable && (
            <div className="split-two-pane">
              <div className="split-map-col--full">
                <Suspense
                  fallback={<div className="map-loading">Loading map...</div>}
                >
                  <SplitEndpointMap
                    gpxTrack={gpxTrack}
                    startKm={profile.startKm}
                    endKm={profile.endKm}
                    endLat={profile.endLat}
                    endLon={profile.endLon}
                    endpointDefined={cumulativeDist != null}
                    unitSystem={unitSystem}
                    restStop={formSplit?.rest_stop ?? null}
                    onSelectStop={() => {}}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
