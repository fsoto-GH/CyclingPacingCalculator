import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  CourseForm as CourseFormState,
  CourseDetail,
  GpxTrackPoint,
  HourlyWeatherPoint,
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
import {
  buildDetailedNearDetail,
  checkArrivalVsHoursDetailed,
  dayIndexInTimezone,
  formatIsoInTzShort,
  formatRatioPercent,
  formatRawDualRatio,
  hoursLabelForEntry,
} from "../timeMath";
import type { SplitWeather, SplitWeatherPair } from "../calculator/weather";
import {
  weatherCodeIcon,
  weatherCodeLabel,
  windDirectionLabel,
} from "../calculator/weather";

const SplitEndpointMap = lazy(() => import("./SplitEndpointMap"));
const TransitSegmentMap = lazy(() => import("./TransitSegmentMap"));

interface EtaInfo {
  status: "open" | "near-open" | "near-close" | "closed";
  statusWord: string;
  hoursLabel: string;
  nearDetail: string | null;
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

  const dayIdx = dayIndexInTimezone(splitResult.end_time, tz);
  const entry = rs.sameHoursEveryDay ? rs.allDays : rs.perDay[dayIdx];

  const status = checkArrivalVsHoursDetailed(
    splitResult.end_time,
    entry,
    tz,
    etaMarginOpen,
    etaMarginClose,
  );
  if (!status) return null;

  const hoursLabel = hoursLabelForEntry(entry);

  const nearDetail =
    status === "near-open" || status === "near-close"
      ? buildDetailedNearDetail(status, splitResult.end_time, entry, tz)
      : null;

  const statusWords: Record<string, string> = {
    open: "Open",
    "near-open": "Near open",
    "near-close": "Near close",
    closed: "Closed",
  };

  return { status, statusWord: statusWords[status], hoursLabel, nearDetail };
}

const fmtInTz = formatIsoInTzShort;

interface ProjectionsViewProps {
  result: CourseDetail | null;
  form: CourseFormState;
  unitSystem: UnitSystem;
  courseTz: string;
  courseStartCity?: string | null;
  segmentIndexes?: number[];
  mapNavTarget?: { segIdx: number; splitIdx: number; rev: number } | null;
  collapseSignal?: number;
  expandAllSignal?: number;
  gpxTrack?: GpxTrackPoint[] | null;
  cityLabels?: (string | null)[][];
  cityFetching?: boolean[][];
  gpxProfiles?: SplitGpxProfile[][] | null;
  splitCumulativeDists?: (number | null)[][] | null;
  gpxTotalDist?: number | null;
  etaMarginOpen?: number;
  etaMarginClose?: number;
  splitWeather?: (SplitWeatherPair | null)[][] | null;
  hourlyWeather?: HourlyWeatherPoint[] | null;
  onZoomToSegment?: (segIdx: number) => void;
  onZoomToSplit?: (segIdx: number, splitIdx: number) => void;
}

export default function ProjectionsView({
  result,
  form,
  unitSystem,
  courseTz,
  courseStartCity,
  segmentIndexes,
  mapNavTarget,
  collapseSignal = 0,
  expandAllSignal = 0,
  gpxTrack,
  cityLabels,
  cityFetching,
  gpxProfiles,
  splitCumulativeDists,
  gpxTotalDist,
  etaMarginOpen = 15,
  etaMarginClose = 7,
  splitWeather,
  hourlyWeather,
  onZoomToSegment,
  onZoomToSplit,
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
            expandSignal={
              mapNavTarget?.segIdx === segIndex ? mapNavTarget.rev : undefined
            }
            expandSplitIdx={
              mapNavTarget?.segIdx === segIndex ? mapNavTarget.splitIdx : -1
            }
            collapseSignal={collapseSignal}
            expandAllSignal={expandAllSignal}
            gpxTrack={gpxTrack ?? null}
            cityLabels={cityLabels?.[segIndex] ?? []}
            cityFetching={cityFetching?.[segIndex] ?? []}
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
            segmentWeather={splitWeather?.[segIndex] ?? null}
            segmentHourlyWeather={
              hourlyWeather
                ? hourlyWeather.filter((p) => p.segIdx === segIndex)
                : null
            }
            onZoomToSegment={onZoomToSegment}
            onZoomToSplit={onZoomToSplit}
          />
        );
      })}
    </div>
  );
}

// ── Weather display helpers ──

function fmtTemp(tempC: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial"
    ? `${Math.round((tempC * 9) / 5 + 32)}°F`
    : `${Math.round(tempC)}°C`;
}

function fmtTempPrecise(tempC: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial"
    ? `${((tempC * 9) / 5 + 32).toFixed(1)}°F`
    : `${tempC.toFixed(1)}°C`;
}

function fmtWind(kmh: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial"
    ? `${Math.round(kmh * 0.621371)} mph`
    : `${Math.round(kmh)} km/h`;
}

function fmtWindPrecise(kmh: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial"
    ? `${(kmh * 0.621371).toFixed(1)} mph`
    : `${kmh.toFixed(1)} km/h`;
}

/** Bearing from point 1 → point 2, degrees 0–360 clockwise from north. */
function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toR = Math.PI / 180;
  const φ1 = lat1 * toR,
    φ2 = lat2 * toR;
  const Δλ = (lon2 - lon1) * toR;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function WeatherCard({
  weather,
  label,
  unitSystem,
}: {
  weather: SplitWeather;
  label: string;
  unitSystem: UnitSystem;
}) {
  return (
    <div className="weather-card">
      <div className="weather-card-label">
        {weatherCodeIcon(weather.weatherCode, weather.isDay)} {label}
      </div>
      <dl className="summary-grid weather-compact-grid">
        <div>
          <dt>Temp / Feels Like</dt>
          <dd
            title={`${fmtTempPrecise(weather.temperature, unitSystem)} / ${fmtTempPrecise(weather.apparentTemperature, unitSystem)}`}
          >
            {fmtTemp(weather.temperature, unitSystem)} (
            {fmtTemp(weather.apparentTemperature, unitSystem)})
          </dd>
        </div>
        <div>
          <dt>Wind / Gusts</dt>
          <dd
            title={`${fmtWindPrecise(weather.windSpeed, unitSystem)} ${windDirectionLabel(weather.windDirection)} (${weather.windDirection}°) — gusts ${fmtWindPrecise(weather.windGusts, unitSystem)}`}
          >
            {fmtWind(weather.windSpeed, unitSystem)} (
            {fmtWind(weather.windGusts, unitSystem)}){" "}
            <span
              title={`${windDirectionLabel(weather.windDirection)} (${weather.windDirection}°)`}
              style={{
                display: "inline-block",
                transform: `rotate(${(weather.windDirection + 180) % 360}deg)`,
                lineHeight: 1,
              }}
            >
              ↑
            </span>
          </dd>
        </div>
        <div>
          <dt>Conditions</dt>
          <dd>
            {weatherCodeLabel(weather.weatherCode)}, {weather.cloudCover}% ☁
          </dd>
        </div>
        <div>
          <dt>
            {weather.precipitationProbabilityAvailable
              ? "Rain % / Humidity"
              : "Rain / Humidity"}
          </dt>
          <dd
            title={
              weather.precipitationProbabilityAvailable
                ? `Precip. probability: ${weather.precipitationProbability}% — Precip.: ${weather.precipitation.toFixed(1)} mm — Humidity: ${weather.humidity}%`
                : `Precip.: ${weather.precipitation.toFixed(1)} mm — Humidity: ${weather.humidity}%`
            }
          >
            {weather.precipitationProbabilityAvailable
              ? `${weather.precipitationProbability}%`
              : `${weather.precipitation.toFixed(1)} mm`}{" "}
            / {weather.humidity}%
          </dd>
        </div>
      </dl>
    </div>
  );
}

function WeatherRangeRow({
  tempMin,
  tempMax,
  unitSystem,
}: {
  tempMin: number;
  tempMax: number;
  unitSystem: UnitSystem;
}) {
  return (
    <span
      className="weather-range-value"
      title={`High: ${fmtTempPrecise(tempMax, unitSystem)} — Low: ${fmtTempPrecise(tempMin, unitSystem)}`}
    >
      <span style={{ color: "#d5202a" }}>{fmtTemp(tempMax, unitSystem)}</span> /{" "}
      <span style={{ color: "#15aadc" }}>{fmtTemp(tempMin, unitSystem)}</span>
    </span>
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
  expandSignal,
  expandSplitIdx,
  collapseSignal,
  expandAllSignal,
  gpxTrack,
  cityLabels,
  cityFetching,
  gpxProfiles,
  splitCumulativeDists,
  segmentStartDist,
  gpxTotalDist,
  etaMarginOpen,
  etaMarginClose,
  segmentWeather,
  segmentHourlyWeather,
  onZoomToSegment,
  onZoomToSplit,
}: {
  segment: SegmentDetail;
  segIndex: number;
  formSegment: SegmentForm | undefined;
  unitSystem: UnitSystem;
  sLabel: string;
  dLabel: string;
  courseTz: string;
  segmentStartCity: string | null;
  expandSignal?: number;
  expandSplitIdx?: number;
  collapseSignal: number;
  expandAllSignal: number;
  gpxTrack: GpxTrackPoint[] | null;
  cityLabels: (string | null)[];
  cityFetching: boolean[];
  gpxProfiles: SplitGpxProfile[] | null;
  splitCumulativeDists: (number | null)[] | null;
  segmentStartDist: number | null;
  gpxTotalDist: number | null;
  etaMarginOpen: number;
  etaMarginClose: number;
  segmentWeather?: (SplitWeatherPair | null)[] | null;
  segmentHourlyWeather?: HourlyWeatherPoint[] | null;
  onZoomToSegment?: (segIdx: number) => void;
  onZoomToSplit?: (segIdx: number, splitIdx: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showResultsGrid, setShowResultsGrid] = useState(false);
  const [targetSplitIdx, setTargetSplitIdx] = useState<number>(-1);
  const [targetSplitSignal, setTargetSplitSignal] = useState(0);
  const [transitJumpPulse, setTransitJumpPulse] = useState(false);
  const transitPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevCollapseSignalRef = useRef(collapseSignal);
  const prevExpandAllSignalRef = useRef(expandAllSignal);
  const segRootRef = useRef<HTMLDivElement | null>(null);
  const lastFiredExpandRef = useRef<number | undefined>(undefined);
  const segColor = SEGMENT_COLORS[segIndex % SEGMENT_COLORS.length];
  const isTransitSegment = !!formSegment?.nullified;

  useEffect(() => {
    if (!expandSignal || expandSignal === lastFiredExpandRef.current) return;
    lastFiredExpandRef.current = expandSignal;
    setCollapsed(false);
    if (isTransitSegment) {
      setTransitJumpPulse(true);
      if (transitPulseTimerRef.current !== null) {
        clearTimeout(transitPulseTimerRef.current);
      }
      transitPulseTimerRef.current = setTimeout(() => {
        setTransitJumpPulse(false);
        transitPulseTimerRef.current = null;
      }, 2200);
    }
    const targetIdx = expandSplitIdx ?? -1;
    if (targetIdx >= 0) {
      setTargetSplitIdx(targetIdx);
      setTargetSplitSignal((s) => s + 1);
    }
    requestAnimationFrame(() => {
      segRootRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => {
      lastFiredExpandRef.current = undefined;
    };
  }, [expandSignal, expandSplitIdx, isTransitSegment]);

  useEffect(() => {
    return () => {
      if (transitPulseTimerRef.current !== null) {
        clearTimeout(transitPulseTimerRef.current);
      }
    };
  }, []);

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
    segment.name?.trim() ||
    formSegment?.name?.trim() ||
    `Segment ${segIndex + 1}`;
  const sleepHms = formSegment ? minutesToHms(formSegment.sleep_time) : "";
  const lastSplitIdx = segment.split_details.length - 1;
  const segEndCity = cityLabels[lastSplitIdx] ?? null;
  const segEndCityFetching = cityFetching[lastSplitIdx] ?? false;
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
  const segWeatherStart = segmentWeather?.[0]?.start ?? null;
  const segWeatherEnd = segmentWeather?.[lastSplitIdx]?.end ?? null;
  const _segMins =
    segmentWeather?.flatMap((p) =>
      p?.tempMin !== undefined ? [p.tempMin] : [],
    ) ?? [];
  const _segMaxs =
    segmentWeather?.flatMap((p) =>
      p?.tempMax !== undefined ? [p.tempMax] : [],
    ) ?? [];
  const segTempMin = _segMins.length > 0 ? Math.min(..._segMins) : undefined;
  const segTempMax = _segMaxs.length > 0 ? Math.max(..._segMaxs) : undefined;

  // Segment-level weather summary stats
  // Prefer hourly data (more samples) when available; fall back to split-pair endpoints.
  const segWeatherStats = useMemo(() => {
    const hasHourly = segmentHourlyWeather && segmentHourlyWeather.length > 0;
    if (!hasHourly && (!segmentWeather || segmentWeather.length === 0))
      return null;
    if (!hasHourly && !segmentWeather?.some((p) => p?.start || p?.end))
      return null;

    let totalSplits = 0;
    let rainySplits = 0;
    let humiditySum = 0;
    let humidityCount = 0;
    const dirCounts = { N: 0, E: 0, S: 0, W: 0 };
    let headCount = 0,
      tailCount = 0,
      crossCount = 0,
      windBearingCount = 0;

    if (hasHourly && segmentHourlyWeather) {
      // Use all hourly points for wind and humidity (high-precision)
      for (const pt of segmentHourlyWeather) {
        const w = pt.weather;
        humiditySum += w.humidity;
        humidityCount++;

        const dir = w.windDirection;
        if (dir >= 315 || dir < 45) dirCounts.N++;
        else if (dir < 135) dirCounts.E++;
        else if (dir < 225) dirCounts.S++;
        else dirCounts.W++;

        // Wind impact: bearing from point to next point along track isn't
        // available per hourly sample, so use the containing split's profile.
        const profile = gpxProfiles?.[pt.splitIdx];
        if (
          profile &&
          !(
            profile.startLat === profile.endLat &&
            profile.startLon === profile.endLon
          )
        ) {
          const bearing = computeBearing(
            profile.startLat,
            profile.startLon,
            profile.endLat,
            profile.endLon,
          );
          const diff = (w.windDirection - bearing + 360) % 360;
          const angle = diff > 180 ? 360 - diff : diff;
          if (angle <= 45) headCount++;
          else if (angle >= 135) tailCount++;
          else crossCount++;
          windBearingCount++;
        }
      }

      // Rainy splits: still derived from per-split pairs (need per-split context)
      if (segmentWeather) {
        segmentWeather.forEach((pair) => {
          if (!pair) return;
          const primary = pair.end ?? pair.start;
          if (!primary) return;
          totalSplits++;
          const isRainy = primary.precipitationProbabilityAvailable
            ? primary.precipitationProbability >= 30
            : primary.precipitation > 0;
          if (isRainy) rainySplits++;
        });
      }
    } else {
      // Legacy path: two samples per split (start + end)
      segmentWeather!.forEach((pair, i) => {
        if (!pair) return;
        const primary = pair.end ?? pair.start;
        if (!primary) return;
        totalSplits++;

        const isRainy = primary.precipitationProbabilityAvailable
          ? primary.precipitationProbability >= 30
          : primary.precipitation > 0;
        if (isRainy) rainySplits++;

        if (pair.start) {
          humiditySum += pair.start.humidity;
          humidityCount++;
        }
        if (pair.end) {
          humiditySum += pair.end.humidity;
          humidityCount++;
        }

        const windSamples = [pair.start, pair.end].filter(
          (w): w is SplitWeather => w !== null,
        );
        for (const w of windSamples) {
          const dir = w.windDirection;
          if (dir >= 315 || dir < 45) dirCounts.N++;
          else if (dir < 135) dirCounts.E++;
          else if (dir < 225) dirCounts.S++;
          else dirCounts.W++;
        }

        const profile = gpxProfiles?.[i];
        const windW = pair.end ?? pair.start;
        if (
          profile &&
          windW &&
          !(
            profile.startLat === profile.endLat &&
            profile.startLon === profile.endLon
          )
        ) {
          const bearing = computeBearing(
            profile.startLat,
            profile.startLon,
            profile.endLat,
            profile.endLon,
          );
          const diff = (windW.windDirection - bearing + 360) % 360;
          const angle = diff > 180 ? 360 - diff : diff;
          if (angle <= 45) headCount++;
          else if (angle >= 135) tailCount++;
          else crossCount++;
          windBearingCount++;
        }
      });
    }

    const windTotal = dirCounts.N + dirCounts.E + dirCounts.S + dirCounts.W;
    return {
      totalSplits,
      rainySplits,
      avgHumidity:
        humidityCount > 0 ? Math.round(humiditySum / humidityCount) : undefined,
      windDir:
        windTotal > 0
          ? {
              N: Math.round((dirCounts.N / windTotal) * 100),
              E: Math.round((dirCounts.E / windTotal) * 100),
              S: Math.round((dirCounts.S / windTotal) * 100),
              W: Math.round((dirCounts.W / windTotal) * 100),
            }
          : undefined,
      windImpact:
        windBearingCount > 0
          ? {
              head: Math.round((headCount / windBearingCount) * 100),
              tail: Math.round((tailCount / windBearingCount) * 100),
              cross: Math.round((crossCount / windBearingCount) * 100),
            }
          : undefined,
    };
  }, [segmentWeather, segmentHourlyWeather, gpxProfiles]);

  const transitSplit = segment.split_details[0] ?? null;
  const transitFormSplit = formSegment?.splits[0];
  const transitProfile = gpxProfiles?.[0] ?? null;
  const transitEtaInfo =
    transitSplit && transitFormSplit
      ? buildEtaInfo(
          transitSplit,
          transitFormSplit,
          courseTz,
          etaMarginOpen,
          etaMarginClose,
        )
      : null;
  const transitMapAvailable = !!gpxTrack && !!transitProfile;
  const transitStartTz = transitSplit?.start_timezone || null;
  const transitEndTz =
    transitSplit?.end_timezone ||
    (transitFormSplit?.differentTimezone && transitFormSplit.timezone
      ? transitFormSplit.timezone
      : null);
  const transitTimeHours = segment.elapsed_time_hours;

  return (
    <div
      className={`segment-form${transitJumpPulse ? " segment-form--transit-jump-pulse" : ""}`}
      ref={segRootRef}
    >
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
              {onZoomToSegment && gpxTrack ? (
                <button
                  type="button"
                  className="split-header-title proj-title-link"
                  title="Go to this segment on the map"
                  onClick={(e) => {
                    e.stopPropagation();
                    onZoomToSegment(segIndex);
                  }}
                >
                  {isTransitSegment && (
                    <i
                      className="fa-solid fa-forward-fast"
                      title="Transit segment — fixed elapsed time"
                      style={{ opacity: 0.8 }}
                    />
                  )}
                  <span className="proj-title-link-text">{title}</span>
                </button>
              ) : (
                <span className="split-header-title">
                  {isTransitSegment && (
                    <i
                      className="fa-solid fa-forward-fast"
                      title="Transit segment — fixed elapsed time"
                      style={{ marginRight: "0.4em", opacity: 0.8 }}
                    />
                  )}
                  {title}
                </span>
              )}
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
            <span
              className="proj-city-duration"
              title={`${formatHours(segment.active_time_hours, "full")} active time (excludes sleep)`}
            >
              <i className="fa-solid fa-stopwatch-20"></i>{" "}
              {segment.active_time_hours.toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{" "}
              hrs
            </span>
            <span className="proj-city-sep"> · </span>
            <span
              className="proj-city-duration"
              title={`${formatHours(segment.down_time_hours, "full")} down time`}
            >
              <i className="fa-solid fa-circle-stop"></i>{" "}
              {segment.down_time_hours.toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{" "}
              hrs
            </span>
            {!isTransitSegment && (
              <>
                <span className="proj-city-sep"> · </span>
                <span
                  className="proj-city-pace"
                  title="Average moving speed of the entire segment."
                >
                  <i className="fa-solid fa-gauge-simple"></i>{" "}
                  {segment.moving_time_hours > 0
                    ? (segment.distance / segment.moving_time_hours).toFixed(2)
                    : "0.00"}{" "}
                  {sLabel}
                </span>
                <span className="proj-city-sep"> · </span>
                <span
                  className="proj-city-pace"
                  title="Average elapsed pace of the entire segment."
                >
                  <i className="fa-solid fa-gauge"></i>{" "}
                  {segment.pace.toFixed(2)} {sLabel}
                </span>
              </>
            )}
          </div>

          {(citySummary ||
            segEndCityFetching ||
            sleepHms ||
            (isTransitSegment &&
              transitFormSplit?.rest_stop.enabled &&
              transitEtaInfo)) && (
            <div className="proj-segment-header-location split-header-city">
              {isTransitSegment &&
                transitFormSplit?.rest_stop.enabled &&
                transitEtaInfo && (
                  <span
                    className={`eta-badge eta-${transitEtaInfo.status}`}
                    title={`${transitEtaInfo.statusWord} (${transitEtaInfo.nearDetail ? transitEtaInfo.nearDetail : transitEtaInfo.hoursLabel})`}
                  >
                    {transitEtaInfo.status === "open" &&
                      (transitEtaInfo.hoursLabel === "24 hours"
                        ? "24/7"
                        : "Open")}
                    {transitEtaInfo.status === "near-open" && "Near open"}
                    {transitEtaInfo.status === "near-close" && "Near close"}
                    {transitEtaInfo.status === "closed" && "Closed"}
                  </span>
                )}
              {!segEndCityFetching && citySummary && (
                <span className="proj-segment-city">{citySummary}</span>
              )}
              {segEndCityFetching && (
                <span className="split-nearby-city--loading">
                  (finding nearest city...)
                </span>
              )}
              {(citySummary || segEndCityFetching) && sleepHms && (
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
            <span className="proj-city-sep"> · </span>
            <span>{formatHours(segment.elapsed_time_hours)}</span>
          </div>

          {(segWeatherStart || segWeatherEnd) && (
            <div className="proj-segment-header-weather split-header-city">
              {segWeatherStart && (
                <span
                  className="split-weather-inline"
                  title={`Departure: ${weatherCodeLabel(segWeatherStart.weatherCode)}, ${fmtTemp(segWeatherStart.temperature, unitSystem)}, Wind ${fmtWind(segWeatherStart.windSpeed, unitSystem)} ${windDirectionLabel(segWeatherStart.windDirection)}`}
                >
                  {weatherCodeIcon(
                    segWeatherStart.weatherCode,
                    segWeatherStart.isDay,
                  )}{" "}
                  {fmtTemp(segWeatherStart.temperature, unitSystem)}{" "}
                  {segWeatherStart.windSpeed > 0 ? (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.75 }} />
                  ) : (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.2 }} />
                  )}{" "}
                  <span
                    style={{
                      display: "inline-block",
                      transform: `rotate(${(segWeatherStart.windDirection + 180) % 360}deg)`,
                      lineHeight: 1,
                    }}
                    title={windDirectionLabel(segWeatherStart.windDirection)}
                  >
                    ↑
                  </span>{" "}
                  {fmtWind(segWeatherStart.windSpeed, unitSystem)}
                </span>
              )}
              {segWeatherStart && segWeatherEnd && (
                <span className="proj-city-sep"> → </span>
              )}
              {segWeatherEnd && (
                <span
                  className="split-weather-inline"
                  title={`Arrival: ${weatherCodeLabel(segWeatherEnd.weatherCode)}, ${fmtTemp(segWeatherEnd.temperature, unitSystem)}, Wind ${fmtWind(segWeatherEnd.windSpeed, unitSystem)} ${windDirectionLabel(segWeatherEnd.windDirection)}`}
                >
                  {weatherCodeIcon(
                    segWeatherEnd.weatherCode,
                    segWeatherEnd.isDay,
                  )}{" "}
                  {fmtTemp(segWeatherEnd.temperature, unitSystem)}{" "}
                  {segWeatherEnd.windSpeed > 0 ? (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.75 }} />
                  ) : (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.2 }} />
                  )}{" "}
                  <span
                    style={{
                      display: "inline-block",
                      transform: `rotate(${(segWeatherEnd.windDirection + 180) % 360}deg)`,
                      lineHeight: 1,
                    }}
                    title={windDirectionLabel(segWeatherEnd.windDirection)}
                  >
                    ↑
                  </span>{" "}
                  {fmtWind(segWeatherEnd.windSpeed, unitSystem)}
                  {" · "}
                  {segTempMin !== undefined && segTempMax !== undefined && (
                    <WeatherRangeRow
                      tempMin={segTempMin}
                      tempMax={segTempMax}
                      unitSystem={unitSystem}
                    />
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="segment-body">
          {!isTransitSegment && (
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
          )}

          {!isTransitSegment && showResultsGrid && (
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
                    title={formatRawDualRatio(
                      adjustmentHours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {formatRatioPercent(
                      adjustmentHours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {formatRatioPercent(
                      adjustmentHours,
                      segment.elapsed_time_hours,
                    )}
                    )
                  </dd>
                </div>
                <div>
                  <dt title="Down-time ratio: active first, segment elapsed in parentheses">
                    Down Ratio
                  </dt>
                  <dd
                    className="proj-segment-ratio-value"
                    title={formatRawDualRatio(
                      segment.down_time_hours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {formatRatioPercent(
                      segment.down_time_hours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {formatRatioPercent(
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
                    title={formatRawDualRatio(
                      segment.moving_time_hours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {formatRatioPercent(
                      segment.moving_time_hours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {formatRatioPercent(
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
                    title={formatRawDualRatio(
                      segment.sleep_time_hours,
                      segment.active_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {formatRatioPercent(
                      segment.sleep_time_hours,
                      segment.active_time_hours,
                    )}{" "}
                    (
                    {formatRatioPercent(
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
                    title={formatRawDualRatio(
                      segment.down_time_hours,
                      segment.moving_time_hours,
                      segment.elapsed_time_hours,
                    )}
                  >
                    {formatRatioPercent(
                      segment.down_time_hours,
                      segment.moving_time_hours,
                    )}{" "}
                    (
                    {formatRatioPercent(
                      segment.down_time_hours,
                      segment.elapsed_time_hours,
                    )}
                    )
                  </dd>
                </div>
                {segWeatherStats && (
                  <>
                    <div>
                      <dt title="Splits with precipitation probability ≥30% (or active precipitation when probability is unavailable)">
                        Rainy Splits
                      </dt>
                      <dd>
                        {segWeatherStats.rainySplits} /{" "}
                        {segWeatherStats.totalSplits}
                      </dd>
                    </div>
                    {segWeatherStats.avgHumidity !== undefined && (
                      <div>
                        <dt title="Average relative humidity across all split endpoints">
                          Avg Humidity
                        </dt>
                        <dd>{segWeatherStats.avgHumidity}%</dd>
                      </div>
                    )}
                    {segWeatherStats.windDir && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <dt title="Proportion of split endpoints with wind from each cardinal direction">
                          Wind Direction
                        </dt>
                        <dd>
                          <i className="fa-solid fa-arrow-up" />{" "}
                          {segWeatherStats.windDir.N}%{" · "}
                          <i className="fa-solid fa-arrow-right" />{" "}
                          {segWeatherStats.windDir.E}%{" · "}
                          <i className="fa-solid fa-arrow-down" />{" "}
                          {segWeatherStats.windDir.S}%{" · "}
                          <i className="fa-solid fa-arrow-left" />{" "}
                          {segWeatherStats.windDir.W}%
                        </dd>
                      </div>
                    )}
                    {segWeatherStats.windImpact && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <dt title="Proportion of splits by wind angle relative to route bearing: headwind (wind ≤45° ahead), crosswind (45–135°), tailwind (≥135° behind)">
                          Wind Impact
                        </dt>
                        <dd>
                          <i className="fa-solid fa-arrow-up" />{" "}
                          {segWeatherStats.windImpact.head}% head{" · "}
                          <i className="fa-solid fa-arrows-left-right" />{" "}
                          {segWeatherStats.windImpact.cross}% cross{" · "}
                          <i className="fa-solid fa-arrow-down" />{" "}
                          {segWeatherStats.windImpact.tail}% tail
                        </dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </div>
          )}

          {isTransitSegment ? (
            <div className="split-results-panel">
              {transitSplit && (
                <dl className="split-results-grid proj-split-results-grid">
                  <div>
                    <dt title="Transit start time">Start</dt>
                    <dd>
                      {fmtInTz(
                        transitSplit.start_time,
                        transitStartTz ?? courseTz,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt title="Transit end time">End</dt>
                    <dd>
                      {fmtInTz(transitSplit.end_time, transitEndTz ?? courseTz)}
                    </dd>
                  </div>
                  <div>
                    <dt title="Transit distance">Distance</dt>
                    <dd>
                      {transitSplit.distance.toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{" "}
                      {dLabel}
                    </dd>
                  </div>
                  <div>
                    <dt title="Transit segment elapsed time">Transit Time</dt>
                    <dd title={formatHours(transitTimeHours, "full")}>
                      {formatHours(transitTimeHours)}
                    </dd>
                  </div>
                  {transitEtaInfo && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <dt title="Hours for the transit endpoint rest stop at ETA.">
                        Rest Stop Hours
                      </dt>
                      <dd>
                        <span>{transitEtaInfo.hoursLabel}</span>
                        {transitEtaInfo.nearDetail && (
                          <span className="split-results-near-detail">
                            {transitEtaInfo.nearDetail}
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              )}

              {transitFormSplit?.rest_stop.enabled &&
                (transitFormSplit.rest_stop.name ||
                  transitFormSplit.rest_stop.address ||
                  transitFormSplit.rest_stop.alt ||
                  transitFormSplit.notes) && (
                  <div className="split-results-rs-info">
                    {transitFormSplit.rest_stop.name && (
                      <div className="split-results-rs-name">
                        {transitFormSplit.rest_stop.alt ? (
                          <a
                            href={transitFormSplit.rest_stop.alt}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {transitFormSplit.rest_stop.name}
                          </a>
                        ) : (
                          transitFormSplit.rest_stop.name
                        )}
                      </div>
                    )}
                    {transitFormSplit.rest_stop.address && (
                      <div className="split-results-rs-address">
                        {transitFormSplit.rest_stop.address}
                      </div>
                    )}
                    {!transitFormSplit.rest_stop.name &&
                      transitFormSplit.rest_stop.alt && (
                        <div className="split-results-rs-address">
                          <a
                            href={transitFormSplit.rest_stop.alt}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {transitFormSplit.rest_stop.alt}
                          </a>
                        </div>
                      )}
                    {transitFormSplit.notes && (
                      <div className="split-results-rs-notes">
                        {transitFormSplit.notes}
                      </div>
                    )}
                  </div>
                )}

              {transitMapAvailable && (
                <div className="split-two-pane">
                  <div className="split-map-col--full">
                    <Suspense
                      fallback={
                        <div className="map-loading">Loading map...</div>
                      }
                    >
                      <TransitSegmentMap
                        gpxTrack={gpxTrack}
                        startKm={transitProfile.startKm}
                        endKm={transitProfile.endKm}
                        unitSystem={unitSystem}
                        segmentColor={segColor}
                        restStop={transitFormSplit?.rest_stop ?? null}
                        onSelectStop={() => {}}
                      />
                    </Suspense>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                className="splits-container"
                style={{ borderLeftColor: `${segColor}33` }}
              >
                {segment.split_details.map((split, splitIndex) => (
                  <ProjectionSplit
                    key={splitIndex}
                    segIndex={segIndex}
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
                    nearbyCityFetching={cityFetching[splitIndex] ?? false}
                    etaMarginOpen={etaMarginOpen}
                    etaMarginClose={etaMarginClose}
                    segColor={segColor}
                    expandSignal={
                      targetSplitIdx === splitIndex
                        ? targetSplitSignal
                        : undefined
                    }
                    splitWeather={segmentWeather?.[splitIndex] ?? null}
                    splitHourlyWeather={
                      segmentHourlyWeather
                        ? segmentHourlyWeather.filter(
                            (p) => p.splitIdx === splitIndex,
                          )
                        : null
                    }
                    onZoomToSplit={onZoomToSplit}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectionSplit({
  segIndex,
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
  nearbyCityFetching,
  etaMarginOpen,
  etaMarginClose,
  segColor,
  expandSignal,
  splitWeather,
  splitHourlyWeather,
  onZoomToSplit,
}: {
  segIndex: number;
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
  nearbyCityFetching: boolean;
  etaMarginOpen: number;
  etaMarginClose: number;
  segColor: string;
  expandSignal?: number;
  splitWeather?: SplitWeatherPair | null;
  splitHourlyWeather?: HourlyWeatherPoint[] | null;
  onZoomToSplit?: (segIdx: number, splitIdx: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showResultsGrid, setShowResultsGrid] = useState(false);
  const splitRootRef = useRef<HTMLDivElement | null>(null);
  const lastFiredExpandRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!expandSignal || expandSignal === lastFiredExpandRef.current) return;
    lastFiredExpandRef.current = expandSignal;
    setCollapsed(false);
    requestAnimationFrame(() => {
      splitRootRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => {
      lastFiredExpandRef.current = undefined;
    };
  }, [expandSignal]);

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
    <div className="split-form" ref={splitRootRef}>
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
              {onZoomToSplit && gpxTrack ? (
                <button
                  type="button"
                  className="split-header-title proj-title-link"
                  title="Go to this split on the map"
                  onClick={(e) => {
                    e.stopPropagation();
                    onZoomToSplit(segIndex, splitIndex);
                  }}
                >
                  <span className="proj-title-link-text">{name}</span>
                </button>
              ) : (
                <span className="split-header-title">{name}</span>
              )}
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
                </>
              )}
            </div>
            <div className="split-header-city">
              <span
                className="proj-city-duration"
                title={`${formatHours(split.moving_time_hours, "full")} moving time`}
              >
                <i className="fa-solid fa-stopwatch-20"></i>{" "}
                {split.moving_time_hours.toLocaleString(undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
                {" hrs"}
              </span>
              <span className="proj-city-sep"> · </span>
              <span>
                <span
                  className="proj-city-duration"
                  title={`${formatHours(split.down_time_hours, "full")} down time`}
                >
                  <i className="fa-solid fa-circle-stop"></i>{" "}
                  {split.down_time_hours.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  {" hrs"}
                </span>
              </span>
              <span className="proj-city-sep"> · </span>
              <span
                className="proj-city-pace"
                title="Average moving speed for this split."
              >
                <i className="fa-solid fa-gauge-simple"></i>{" "}
                {split.moving_speed.toFixed(2)} {sLabel}
              </span>
              <span className="proj-city-sep"> · </span>
              <span
                className="proj-city-pace"
                title="Average elapsed pace for this split."
              >
                <i className="fa-solid fa-gauge"></i> {split.pace.toFixed(2)}{" "}
                {sLabel}
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
            <span className="proj-city-sep"> · </span>
            <span>{formatHours(split.active_time_hours)}</span>
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
            {nearbyCityFetching && (
              <span className="split-nearby-city--loading">
                (finding nearest city...)
              </span>
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

          {/* (2,1) start → end temp + hi/lo */}
          {(splitWeather?.start || splitWeather?.end) && (
            <div className="proj-split-header-hilow split-header-city">
              {splitWeather?.start && (
                <span
                  className="split-weather-inline"
                  title={`Departure: ${weatherCodeLabel(splitWeather.start.weatherCode)}, ${fmtTemp(splitWeather.start.temperature, unitSystem)}, Wind ${fmtWind(splitWeather.start.windSpeed, unitSystem)} ${windDirectionLabel(splitWeather.start.windDirection)}`}
                >
                  {weatherCodeIcon(
                    splitWeather.start.weatherCode,
                    splitWeather.start.isDay,
                  )}{" "}
                  {fmtTemp(splitWeather.start.temperature, unitSystem)}{" "}
                  {splitWeather.start.windSpeed > 0 ? (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.75 }} />
                  ) : (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.2 }} />
                  )}{" "}
                  <span
                    style={{
                      display: "inline-block",
                      transform: `rotate(${(splitWeather.start.windDirection + 180) % 360}deg)`,
                      lineHeight: 1,
                    }}
                    title={windDirectionLabel(splitWeather.start.windDirection)}
                  >
                    ↑
                  </span>{" "}
                  {fmtWind(splitWeather.start.windSpeed, unitSystem)}
                </span>
              )}
              {splitWeather?.start && splitWeather?.end && (
                <span className="proj-city-sep"> → </span>
              )}
              {splitWeather?.end && (
                <span
                  className="split-weather-inline"
                  title={`Arrival: ${weatherCodeLabel(splitWeather.end.weatherCode)}, ${fmtTemp(splitWeather.end.temperature, unitSystem)}, Wind ${fmtWind(splitWeather.end.windSpeed, unitSystem)} ${windDirectionLabel(splitWeather.end.windDirection)}`}
                >
                  {weatherCodeIcon(
                    splitWeather.end.weatherCode,
                    splitWeather.end.isDay,
                  )}{" "}
                  {fmtTemp(splitWeather.end.temperature, unitSystem)}{" "}
                  {splitWeather.end.windSpeed > 0 ? (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.75 }} />
                  ) : (
                    <i className="fa-solid fa-wind" style={{ opacity: 0.2 }} />
                  )}{" "}
                  <span
                    style={{
                      display: "inline-block",
                      transform: `rotate(${(splitWeather.end.windDirection + 180) % 360}deg)`,
                      lineHeight: 1,
                    }}
                    title={windDirectionLabel(splitWeather.end.windDirection)}
                  >
                    ↑
                  </span>{" "}
                  {fmtWind(splitWeather.end.windSpeed, unitSystem)}
                </span>
              )}
              {splitWeather?.tempMin !== undefined &&
                splitWeather?.tempMax !== undefined && (
                  <>
                    <span className="proj-city-sep"> · </span>
                    <WeatherRangeRow
                      tempMin={splitWeather.tempMin}
                      tempMax={splitWeather.tempMax}
                      unitSystem={unitSystem}
                    />
                  </>
                )}
            </div>
          )}
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
              {(() => {
                const windW = splitWeather?.end ?? splitWeather?.start ?? null;
                if (
                  !windW ||
                  !profile ||
                  (profile.startLat === profile.endLat &&
                    profile.startLon === profile.endLon)
                )
                  return null;
                const bearing = computeBearing(
                  profile.startLat,
                  profile.startLon,
                  profile.endLat,
                  profile.endLon,
                );
                const diff = (windW.windDirection - bearing + 360) % 360;
                const angle = diff > 180 ? 360 - diff : diff;
                const impact =
                  angle <= 45
                    ? "▲ Headwind"
                    : angle >= 135
                      ? "▼ Tailwind"
                      : "↔ Crosswind";
                const impactTitle = `Wind from ${windDirectionLabel(windW.windDirection)} (${windW.windDirection}°) vs route bearing ${Math.round(bearing)}° — angle ${Math.round(angle)}°`;
                return (
                  <>
                    <div>
                      <dt title="Cardinal direction the wind is blowing from across both endpoints">
                        Wind Direction
                      </dt>
                      <dd>
                        {[splitWeather?.start, splitWeather?.end]
                          .filter((w): w is SplitWeather => w !== null)
                          .map((w, i, arr) => (
                            <span key={i}>
                              <span
                                style={{
                                  display: "inline-block",
                                  transform: `rotate(${(w.windDirection + 180) % 360}deg)`,
                                  lineHeight: 1,
                                }}
                                title={windDirectionLabel(w.windDirection)}
                              >
                                ↑
                              </span>{" "}
                              {windDirectionLabel(w.windDirection)} (
                              {w.windDirection}°)
                              {i < arr.length - 1 && (
                                <span className="proj-city-sep"> → </span>
                              )}
                            </span>
                          ))}
                      </dd>
                    </div>
                    <div>
                      <dt title={impactTitle}>Wind Impact</dt>
                      <dd title={impactTitle}>
                        {impact} ({Math.round(angle)}° off route)
                      </dd>
                    </div>
                  </>
                );
              })()}
              {splitWeather?.start && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <WeatherCard
                    weather={splitWeather.start}
                    label="Departure"
                    unitSystem={unitSystem}
                  />
                </div>
              )}
              {splitWeather?.end && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <WeatherCard
                    weather={splitWeather.end}
                    label="Arrival"
                    unitSystem={unitSystem}
                  />
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
                    splitHourlyWeather={splitHourlyWeather}
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
