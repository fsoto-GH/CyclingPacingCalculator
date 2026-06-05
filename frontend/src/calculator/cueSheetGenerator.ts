/**
 * Cue sheet HTML generator.
 *
 * Generates a self-contained, print-friendly HTML string from calculated
 * course results. Supports two output modes:
 *  - Regular table (wide, multi-column, full detail)
 *  - Compact list (one entry per stop/split, color-coded, print-optimized)
 */

import type {
  CourseForm as CourseFormState,
  CourseDetail,
  GpxTrackPoint,
  GpxWaypoint,
  RestStopForm,
  IntermediateRestStopForm,
  DayHoursEntry,
  UnitSystem,
} from "../types";
import {
  formatArrivalTimeWithTz,
  dayIndexInTimezone,
  hoursLabelForEntry,
  checkArrivalVsHoursDetailed,
} from "../timeMath";
import { findNearestTrackPoint } from "./gpxParser";

const KM_PER_MI = 1.60934;

// Default margins matching ProjectionsView defaults
const ETA_MARGIN_OPEN = 15;
const ETA_MARGIN_CLOSE = 7;

// ---------------------------------------------------------------------------
// Public option/data types
// ---------------------------------------------------------------------------

export interface CueSheetOptions {
  mileMarkerDirection: "from-start" | "from-end";
  includeSplitDistance: boolean;
  includeEta: boolean;
  includeNotes: boolean;
  compact: boolean;

  /** Shown before rest stop in both table and compact modes */
  includeIntermediateStop: boolean;
  intermediateIncludeHours: boolean;
  intermediateIncludeEta: boolean;

  includeRestStop: boolean;
  restStopIncludeHours: boolean;
  restStopIncludeEta: boolean;

  /** Only used in regular (non-compact) table mode */
  includeCoursePoints: boolean;
  selectedCueTypes: Set<string>;

  /** Only used in regular (non-compact) table mode */
  includePois: boolean;
  selectedPoiTypes: Set<string>;

  unitSystem: UnitSystem;
}

export interface CueSheetData {
  form: CourseFormState;
  result: CourseDetail;
  /** [segIdx][splitIdx] → [startKm, endKm] */
  splitBoundariesKm: ([number, number] | undefined)[][];
  gpxTrack: GpxTrackPoint[];
  rwgpsCoursePoints: GpxWaypoint[];
  rwgpsPois: GpxWaypoint[];
  courseTz: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type EtaStatus = "open" | "near-open" | "near-close" | "closed" | null;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toDisplayDist(km: number, unitSystem: UnitSystem): number {
  return unitSystem === "imperial" ? km / KM_PER_MI : km;
}

function fmtDist(km: number, unitSystem: UnitSystem): string {
  const v = toDisplayDist(km, unitSystem);
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function unitLabel(unitSystem: UnitSystem): string {
  return unitSystem === "imperial" ? "mi" : "km";
}

function hoursEntryForArrival(
  arrivalIso: string,
  tz: string,
  stop: RestStopForm | IntermediateRestStopForm,
): DayHoursEntry {
  if (stop.sameHoursEveryDay) return stop.allDays;
  const dayIdx = dayIndexInTimezone(arrivalIso, tz);
  return stop.perDay[dayIdx];
}

function etaStatusClass(status: EtaStatus): string {
  if (!status) return "cs-eta--unknown";
  if (status === "open") return "cs-eta--open";
  if (status === "near-open" || status === "near-close") return "cs-eta--near";
  return "cs-eta--closed";
}

/**
 * Compute intermediate stop position (cumulative km) and elapsed-pace ETA.
 */
function computeIntermediateStop(
  is: IntermediateRestStopForm,
  splitStartIso: string,
  splitEndIso: string,
  splitDistUser: number,
  startKm: number,
  endKm: number,
  mode: string,
  unitSystem: UnitSystem,
  gpxTrack: GpxTrackPoint[],
): { cumKm: number | null; etaIso: string | null } {
  let cumKm: number | null = null;

  if (
    is.lat != null &&
    is.lon != null &&
    Number.isFinite(is.lat) &&
    Number.isFinite(is.lon) &&
    gpxTrack.length > 0
  ) {
    const snapped = findNearestTrackPoint(
      gpxTrack,
      is.lat,
      is.lon,
      startKm,
      endKm,
    );
    if (snapped) cumKm = snapped.cumDist;
  }

  if (cumKm == null && is.distance.trim()) {
    const d = parseFloat(is.distance);
    if (Number.isFinite(d)) {
      const dKm = d * (unitSystem === "imperial" ? KM_PER_MI : 1);
      cumKm = mode === "target_distance" ? dKm : startKm + dKm;
    }
  }

  let etaIso: string | null = null;
  if (cumKm != null) {
    const relKm = cumKm - startKm;
    const relDistUser = unitSystem === "imperial" ? relKm / KM_PER_MI : relKm;

    const startMs = Date.parse(splitStartIso);
    const endMs = Date.parse(splitEndIso);
    if (
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs >= startMs &&
      splitDistUser > 0
    ) {
      const clamped = Math.max(0, Math.min(splitDistUser, relDistUser));
      const msPerUnit = (endMs - startMs) / splitDistUser;
      if (Number.isFinite(msPerUnit) && msPerUnit > 0) {
        etaIso = new Date(startMs + clamped * msPerUnit).toISOString();
      }
    }
  }

  return { cumKm, etaIso };
}

function poiCumDist(
  poi: GpxWaypoint,
  gpxTrack: GpxTrackPoint[],
): number | null {
  if (!gpxTrack.length) return null;
  const nearest = findNearestTrackPoint(
    gpxTrack,
    poi.lat,
    poi.lon,
    0,
    gpxTrack[gpxTrack.length - 1].cumDist,
  );
  return nearest?.cumDist ?? null;
}

function coursePointCumDist(
  cp: GpxWaypoint,
  gpxTrack: GpxTrackPoint[],
): number | null {
  if (cp.cueTrackIndex != null && gpxTrack[cp.cueTrackIndex] != null) {
    return gpxTrack[cp.cueTrackIndex].cumDist;
  }
  return poiCumDist(cp, gpxTrack);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Shared HTML head (includes both table and compact CSS)
// ---------------------------------------------------------------------------

function buildHead(courseName: string, ul: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(courseName)} — Cue Sheet</title>
<style>
/* ============================================================
   CUE SHEET STYLES
   Feel free to customise this block to match your event branding.
   ============================================================ */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11pt;
  color: #111;
  background: #fff;
  padding: 16px 20px;
}

h1 { font-size: 16pt; margin-bottom: 4px; }
.meta { font-size: 9pt; color: #555; margin-bottom: 16px; }

/* ── Table mode ── */
table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }

th {
  background: #1a1a2e;
  color: #fff;
  padding: 6px 8px;
  text-align: left;
  font-size: 9pt;
  white-space: nowrap;
}

td {
  padding: 5px 8px;
  border-bottom: 1px solid #ddd;
  vertical-align: top;
  font-size: 10pt;
}

tr:nth-child(even) td { background: #f7f7f7; }
.marker    { font-weight: bold; white-space: nowrap; }
.eta       { white-space: nowrap; }
.stop-section { margin-top: 4px; font-size: 9pt; color: #333; }
.stop-label   { font-weight: bold; }
.sub-item     { margin-left: 8px; }
.cues-list, .poi-list { margin: 0; padding: 0 0 0 16px; font-size: 9pt; }
.cues-list li, .poi-list li { margin: 2px 0; }
.unit       { font-size: 8pt; color: #666; }
.notes-cell { font-size: 9pt; color: #555; font-style: italic; }

/* ── Compact mode ── */
.cs-list { max-width: 680px; }

.cs-entry {
  padding: 5px 8px 5px 10px;
  margin-bottom: 2px;
  border-left: 3px solid #bbb;
  line-height: 1.5;
}

.cs-entry--intermediate { background: #eff6ff; border-left-color: #3b82f6; }
.cs-entry--split        { background: #f9fafb; border-left-color: #9ca3af; }
.cs-entry--transit      { background: #fffbeb; border-left-color: #f59e0b; }
.cs-entry--start        { background: #f0fdf4; border-left-color: #16a34a; }
.cs-entry--end          { background: #fff1f2; border-left-color: #e11d48; }

.cs-header   { font-weight: bold; font-size: 11pt; }
.cs-dist     { font-weight: normal; color: #555; }
.cs-name     { font-weight: normal; }
.cs-details  { padding-left: 20px; font-size: 10pt; color: #444; }
.cs-detail-line { margin-top: 1px; }
.cs-notes    { color: #888; font-style: italic; }

.cs-eta--open    { color: #16a34a; font-weight: 500; }
.cs-eta--near    { color: #b45309; font-weight: 500; }
.cs-eta--closed  { color: #dc2626; font-weight: 500; }
.cs-eta--unknown { color: #374151; }

/* ── Print ── */
@media print {
  body { padding: 0; font-size: 10pt; }
  th {
    background: #000 !important;
    color: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  tr:nth-child(even) td {
    background: #f0f0f0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table { page-break-inside: auto; }
  tr    { page-break-inside: avoid; }
  .cs-entry { page-break-inside: avoid; }
  .cs-entry--intermediate { background: #eff6ff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cs-entry--split        { background: #f9fafb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cs-entry--transit      { background: #fffbeb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cs-entry--start        { background: #f0fdf4 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cs-entry--end          { background: #fff1f2 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
}
</style>
</head>
<body>
<h1>${esc(courseName)}</h1>
<div class="meta">Generated ${new Date().toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })} &nbsp;|&nbsp; Distances in ${esc(ul)}</div>
`;
}

// ---------------------------------------------------------------------------
// Regular table mode
// ---------------------------------------------------------------------------

function generateTableHtml(opts: CueSheetOptions, data: CueSheetData): string {
  const {
    form,
    result,
    splitBoundariesKm,
    gpxTrack,
    rwgpsCoursePoints,
    rwgpsPois,
    courseTz,
  } = data;
  const ul = unitLabel(opts.unitSystem);

  let totalKm = 0;
  for (const segBounds of splitBoundariesKm) {
    for (const b of segBounds) {
      if (b && b[1] > totalKm) totalKm = b[1];
    }
  }

  const headers: string[] = [
    opts.mileMarkerDirection === "from-end"
      ? `Mile Marker from End (${ul})`
      : `Mile Marker (${ul})`,
    "Split Name",
  ];
  if (opts.includeSplitDistance) headers.push(`Distance (${ul})`);
  if (opts.includeEta) headers.push("ETA");
  if (opts.includeNotes) headers.push("Notes");
  if (opts.includeIntermediateStop || opts.includeRestStop)
    headers.push("Stops");
  if (opts.includeCoursePoints) headers.push("Cues");
  if (opts.includePois) headers.push("Points of Interest");

  const theadCells = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const rows: string[] = [];

  for (let si = 0; si < form.segments.length; si++) {
    const seg = form.segments[si];
    const segDetail = result.segment_details[si];
    if (!segDetail) continue;

    for (let splitIdx = 0; splitIdx < seg.splits.length; splitIdx++) {
      const formSplit = seg.splits[splitIdx];
      const splitDetail = segDetail.split_details[splitIdx];
      const bounds = splitBoundariesKm[si]?.[splitIdx];
      if (!splitDetail || !bounds) continue;

      const [startKm, endKm] = bounds;
      const markerKm =
        opts.mileMarkerDirection === "from-end" ? totalKm - endKm : endKm;
      const splitTz = splitDetail.end_timezone ?? courseTz;

      const markerCell = `<td class="marker">${fmtDist(markerKm, opts.unitSystem)}</td>`;
      const nameCell = `<td>${esc(formSplit.name?.trim() || `Split ${splitIdx + 1}`)}</td>`;

      let distCell = "";
      if (opts.includeSplitDistance) {
        distCell = `<td>${fmtDist(endKm - startKm, opts.unitSystem)}</td>`;
      }

      let etaCell = "";
      if (opts.includeEta) {
        etaCell = `<td class="eta">${esc(formatArrivalTimeWithTz(splitDetail.end_time, splitTz))}</td>`;
      }

      let notesCell = "";
      if (opts.includeNotes) {
        notesCell = `<td class="notes-cell">${esc(formSplit.notes?.trim() || "")}</td>`;
      }

      // ── Stops cell: intermediate first, rest stop second ──
      let stopCell = "";
      if (opts.includeIntermediateStop || opts.includeRestStop) {
        const parts: string[] = [];

        // ① Intermediate stop
        const is = formSplit.intermediate_stop;
        if (opts.includeIntermediateStop && is?.enabled) {
          const { cumKm: intermKm, etaIso: intermEtaIso } =
            computeIntermediateStop(
              is,
              splitDetail.start_time,
              splitDetail.end_time,
              splitDetail.distance,
              startKm,
              endKm,
              form.mode,
              opts.unitSystem,
              gpxTrack,
            );

          const intermMarkerKm =
            intermKm != null
              ? opts.mileMarkerDirection === "from-end"
                ? totalKm - intermKm
                : intermKm
              : null;

          let inner = `<span class="stop-label">${esc(is.name || "Intermediate Stop")}</span>`;
          if (intermMarkerKm != null) {
            inner += ` <span class="unit">@ ${fmtDist(intermMarkerKm, opts.unitSystem)} ${ul}</span>`;
          }
          if (opts.intermediateIncludeHours) {
            const etaForDay = intermEtaIso ?? splitDetail.end_time;
            const entry = hoursEntryForArrival(etaForDay, splitTz, is);
            inner += `<br><span class="sub-item">Hours: ${esc(hoursLabelForEntry(entry))}</span>`;
          }
          if (opts.intermediateIncludeEta && intermEtaIso) {
            inner += `<br><span class="sub-item">ETA: ${esc(formatArrivalTimeWithTz(intermEtaIso, splitTz))}</span>`;
          }
          parts.push(`<div class="stop-section">${inner}</div>`);
        }

        // ② Rest stop (at split endpoint — mile marker not repeated)
        const rs = formSplit.rest_stop;
        if (opts.includeRestStop && rs.enabled) {
          let inner = `<span class="stop-label">${esc(rs.name || "Rest Stop")}</span>`;
          if (opts.restStopIncludeHours) {
            const entry = hoursEntryForArrival(
              splitDetail.end_time,
              splitTz,
              rs,
            );
            inner += `<br><span class="sub-item">Hours: ${esc(hoursLabelForEntry(entry))}</span>`;
          }
          if (opts.restStopIncludeEta) {
            inner += `<br><span class="sub-item">ETA: ${esc(formatArrivalTimeWithTz(splitDetail.end_time, splitTz))}</span>`;
          }
          parts.push(`<div class="stop-section">${inner}</div>`);
        }

        stopCell = `<td>${parts.join("")}</td>`;
      }

      // ── Course points ──
      let cueCell = "";
      if (opts.includeCoursePoints) {
        const splitCues = rwgpsCoursePoints.filter((cp) => {
          const d = coursePointCumDist(cp, gpxTrack);
          if (d == null || d < startKm || d > endKm) return false;
          if (opts.selectedCueTypes.size === 0) return true;
          return opts.selectedCueTypes.has(cp.description?.trim() || "");
        });
        if (splitCues.length > 0) {
          const items = splitCues
            .map(
              (cp) =>
                `<li>${esc(cp.name)}${cp.description ? ` <span class="unit">(${esc(cp.description)})</span>` : ""}</li>`,
            )
            .join("");
          cueCell = `<td><ul class="cues-list">${items}</ul></td>`;
        } else {
          cueCell = `<td></td>`;
        }
      }

      // ── POIs ──
      let poiCell = "";
      if (opts.includePois) {
        const splitPois = rwgpsPois.filter((poi) => {
          const d = poiCumDist(poi, gpxTrack);
          if (d == null || d < startKm || d > endKm) return false;
          if (opts.selectedPoiTypes.size === 0) return true;
          return opts.selectedPoiTypes.has(poi.poiType ?? "");
        });
        if (splitPois.length > 0) {
          const items = splitPois
            .map((poi) => {
              const d = poiCumDist(poi, gpxTrack);
              const distStr =
                d != null
                  ? ` <span class="unit">@ ${fmtDist(
                      opts.mileMarkerDirection === "from-end" ? totalKm - d : d,
                      opts.unitSystem,
                    )} ${ul}</span>`
                  : "";
              return `<li>${esc(poi.name)}${distStr}</li>`;
            })
            .join("");
          poiCell = `<td><ul class="poi-list">${items}</ul></td>`;
        } else {
          poiCell = `<td></td>`;
        }
      }

      const cells = [
        markerCell,
        nameCell,
        distCell,
        etaCell,
        notesCell,
        stopCell,
        cueCell,
        poiCell,
      ]
        .filter((c) => c !== "")
        .join("");
      rows.push(`<tr>${cells}</tr>`);
    }
  }

  const courseName = form.name?.trim() || "Course";
  return `${buildHead(courseName, ul)}
<table>
  <thead><tr>${theadCells}</tr></thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Compact list mode
// ---------------------------------------------------------------------------

interface CompactEntry {
  entryType: "intermediate" | "split" | "transit";
  typeNum: number;
  displayMarkerKm: number;
  splitDistKm: number | null;
  splitName: string | null;
  stopName: string | null;
  hoursLabel: string | null;
  etaIso: string | null;
  etaTz: string;
  etaStatus: EtaStatus;
  notes: string | null;
}

function generateCompactHtml(
  opts: CueSheetOptions,
  data: CueSheetData,
): string {
  const { form, result, splitBoundariesKm, gpxTrack, courseTz } = data;
  const ul = unitLabel(opts.unitSystem);

  let totalKm = 0;
  for (const segBounds of splitBoundariesKm) {
    for (const b of segBounds) {
      if (b && b[1] > totalKm) totalKm = b[1];
    }
  }

  const entries: CompactEntry[] = [];
  let iCount = 0;
  let sCount = 0;
  let tCount = 0;

  for (let si = 0; si < form.segments.length; si++) {
    const seg = form.segments[si];
    const segDetail = result.segment_details[si];
    if (!segDetail) continue;

    const isTransitSeg = parseFloat((seg.fixed_elapsed_time ?? "").trim()) > 0;

    for (let splitIdx = 0; splitIdx < seg.splits.length; splitIdx++) {
      const formSplit = seg.splits[splitIdx];
      const splitDetail = segDetail.split_details[splitIdx];
      const bounds = splitBoundariesKm[si]?.[splitIdx];
      if (!splitDetail || !bounds) continue;

      const [startKm, endKm] = bounds;
      const splitTz = splitDetail.end_timezone ?? courseTz;

      // ── ① Intermediate stop entry ──
      const is = formSplit.intermediate_stop;
      if (opts.includeIntermediateStop && is?.enabled) {
        const { cumKm: intermKm, etaIso: rawIntermEtaIso } =
          computeIntermediateStop(
            is,
            splitDetail.start_time,
            splitDetail.end_time,
            splitDetail.distance,
            startKm,
            endKm,
            form.mode,
            opts.unitSystem,
            gpxTrack,
          );

        const displayKm =
          intermKm != null
            ? opts.mileMarkerDirection === "from-end"
              ? totalKm - intermKm
              : intermKm
            : opts.mileMarkerDirection === "from-end"
              ? totalKm - endKm
              : endKm;

        let hoursLabel: string | null = null;
        let etaStatus: EtaStatus = null;

        if (opts.intermediateIncludeHours || rawIntermEtaIso) {
          const etaForDay = rawIntermEtaIso ?? splitDetail.end_time;
          const entry = hoursEntryForArrival(etaForDay, splitTz, is);
          if (opts.intermediateIncludeHours) {
            hoursLabel = hoursLabelForEntry(entry);
          }
          if (rawIntermEtaIso) {
            etaStatus =
              checkArrivalVsHoursDetailed(
                rawIntermEtaIso,
                entry,
                splitTz,
                ETA_MARGIN_OPEN,
                ETA_MARGIN_CLOSE,
              ) ?? null;
          }
        }

        iCount++;
        entries.push({
          entryType: "intermediate",
          typeNum: iCount,
          displayMarkerKm: displayKm,
          splitDistKm: null,
          splitName: null,
          stopName: is.name || "Intermediate Stop",
          hoursLabel,
          etaIso: opts.intermediateIncludeEta ? rawIntermEtaIso : null,
          etaTz: splitTz,
          etaStatus,
          notes: null,
        });
      }

      // ── ② Split / transit endpoint entry ──
      isTransitSeg ? tCount++ : sCount++;

      const displayMarkerKm =
        opts.mileMarkerDirection === "from-end" ? totalKm - endKm : endKm;

      let stopName: string | null = null;
      let hoursLabel: string | null = null;
      let etaStatus: EtaStatus = null;

      const rs = formSplit.rest_stop;
      if (opts.includeRestStop && rs.enabled) {
        stopName = rs.name || "Rest Stop";
        const rsEntry = hoursEntryForArrival(splitDetail.end_time, splitTz, rs);
        if (opts.restStopIncludeHours) {
          hoursLabel = hoursLabelForEntry(rsEntry);
        }
        etaStatus =
          checkArrivalVsHoursDetailed(
            splitDetail.end_time,
            rsEntry,
            splitTz,
            ETA_MARGIN_OPEN,
            ETA_MARGIN_CLOSE,
          ) ?? null;
      }

      entries.push({
        entryType: isTransitSeg ? "transit" : "split",
        typeNum: isTransitSeg ? tCount : sCount,
        displayMarkerKm,
        splitDistKm: opts.includeSplitDistance ? endKm - startKm : null,
        splitName: formSplit.name?.trim() || `Split ${splitIdx + 1}`,
        stopName,
        hoursLabel,
        etaIso: opts.includeEta ? splitDetail.end_time : null,
        etaTz: splitTz,
        etaStatus,
        notes: opts.includeNotes ? formSplit.notes?.trim() || null : null,
      });
    }
  }

  // ── Build HTML ──
  const rows = entries.map((entry, idx) => {
    const isStart = idx === 0;
    const isEnd = idx === entries.length - 1;

    const typeClass = isStart
      ? "cs-entry--start"
      : isEnd
        ? "cs-entry--end"
        : entry.entryType === "intermediate"
          ? "cs-entry--intermediate"
          : entry.entryType === "transit"
            ? "cs-entry--transit"
            : "cs-entry--split";

    const prefix =
      entry.entryType === "intermediate"
        ? "I"
        : entry.entryType === "transit"
          ? "T"
          : "S";

    const distStr =
      entry.splitDistKm != null
        ? ` <span class="cs-dist">[${fmtDist(entry.splitDistKm, opts.unitSystem)}]</span>`
        : "";

    const nameStr = entry.splitName
      ? ` <span class="cs-name">${esc(entry.splitName)}</span>`
      : "";

    const header = `<div class="cs-header"><span class="cs-marker">${fmtDist(entry.displayMarkerKm, opts.unitSystem)}</span>: <span class="cs-label">${prefix}${entry.typeNum}</span>${distStr} ${nameStr}</div>`;

    const detailLines: string[] = [];

    if (entry.stopName) {
      const hoursStr = entry.hoursLabel ? `: ${esc(entry.hoursLabel)}` : "";
      detailLines.push(
        `<div class="cs-detail-line">${esc(entry.stopName)}${hoursStr}</div>`,
      );
    }

    if (entry.notes) {
      detailLines.push(
        `<div class="cs-detail-line cs-notes">${esc(entry.notes)}</div>`,
      );
    }

    if (entry.etaIso) {
      const etaTime = formatArrivalTimeWithTz(entry.etaIso, entry.etaTz);
      const etaCls = etaStatusClass(entry.etaStatus);
      detailLines.push(
        `<div class="cs-detail-line"><span class="${etaCls}">ETA: ${esc(etaTime)}</span></div>`,
      );
    }

    const details =
      detailLines.length > 0
        ? `<div class="cs-details">${detailLines.join("")}</div>`
        : "";

    return `<div class="cs-entry ${typeClass}">\n${header}\n${details}\n</div>`;
  });

  const courseName = form.name?.trim() || "Course";
  return `${buildHead(courseName, ul)}<div class="cs-list">
${rows.join("\n")}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function generateCueSheetHtml(
  opts: CueSheetOptions,
  data: CueSheetData,
): string {
  return opts.compact
    ? generateCompactHtml(opts, data)
    : generateTableHtml(opts, data);
}
