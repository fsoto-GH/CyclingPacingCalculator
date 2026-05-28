import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type {
  GpxTrackPoint,
  GpxWaypoint,
  SplitGpxProfile,
  SplitForm as SplitFormType,
  UnitSystem,
  RestStopForm,
} from "../types";
import {
  sliceTrackPoints,
  buildGpxString,
  findNearestTrackPoint,
} from "../calculator/gpxParser";
import { distanceLabel, SEGMENT_COLORS } from "../utils";

/** Build a human-readable hours description from a RestStopForm for GPX export. */
function buildRestStopDescription(rs: RestStopForm): string {
  if (rs.sameHoursEveryDay) {
    const e = rs.allDays;
    if (e.mode === "24h") return "Hours: Open 24h";
    if (e.mode === "closed") return "Hours: Closed";
    return `Hours: ${e.opens}-${e.closes}`;
  }
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return rs.perDay
    .map((e, i) => {
      if (e.mode === "24h") return `${DAY[i]}: 24h`;
      if (e.mode === "closed") return `${DAY[i]}: Closed`;
      return `${DAY[i]}: ${e.opens}-${e.closes}`;
    })
    .join(", ");
}

interface SegmentExportInfo {
  name?: string | null;
  splits: SplitFormType[];
}

interface GpxExportModalProps {
  open: boolean;
  onClose: () => void;
  /** All segments in the course, each with their splits. */
  segments: SegmentExportInfo[];
  gpxTrack: GpxTrackPoint[];
  /** [segIdx][splitIdx] → [startKm, endKm] */
  splitBoundariesKm: ([number, number] | undefined)[][];
  /** [segIdx][splitIdx] → profile stats */
  gpxProfiles: (SplitGpxProfile | undefined | null)[][];
  unitSystem: UnitSystem;
  /** Original GPX <wpt> waypoints from the loaded track file */
  gpxWaypoints?: GpxWaypoint[];
  /** RideWithGPS Points of Interest */
  rwgpsPois?: GpxWaypoint[];
  /** RideWithGPS course/cue points */
  rwgpsCoursePoints?: GpxWaypoint[];
  /** Default file name (course name) */
  defaultFileName?: string;
}

export default function GpxExportModal({
  open,
  onClose,
  segments,
  gpxTrack,
  splitBoundariesKm,
  gpxProfiles,
  unitSystem,
  gpxWaypoints,
  rwgpsPois,
  rwgpsCoursePoints,
  defaultFileName = "Course",
}: GpxExportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const courseSelectAllRef = useRef<HTMLInputElement>(null);
  const segSelectRefs = useRef<(HTMLInputElement | null)[]>([]);

  // checked[segIdx][splitIdx]
  const [checked, setChecked] = useState<boolean[][]>(() =>
    segments.map((seg) => seg.splits.map(() => true)),
  );
  const [exporting, setExporting] = useState(false);
  const [includeRwgpsPois, setIncludeRwgpsPois] = useState(true);
  const [includeRwgpsCoursePoints, setIncludeRwgpsCoursePoints] =
    useState(false);
  // collapsed[si] = true means that segment's splits are hidden
  const [collapsed, setCollapsed] = useState<boolean[]>(() =>
    segments.map(() => true),
  );
  // Re-init checked + collapsed when the modal is opened or structure changes
  useEffect(() => {
    if (open) {
      setChecked(segments.map((seg) => seg.splits.map(() => true)));
      setCollapsed(segments.map(() => true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleCollapsed = (si: number) =>
    setCollapsed((prev) => prev.map((v, i) => (i === si ? !v : v)));

  // Open/close the native dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // --- Tri-state helpers ---
  const segState = useCallback(
    (si: number): "all" | "some" | "none" => {
      const cs = checked[si] ?? [];
      if (cs.length === 0) return "none";
      if (cs.every(Boolean)) return "all";
      if (cs.some(Boolean)) return "some";
      return "none";
    },
    [checked],
  );

  const courseState: "all" | "some" | "none" = useMemo(() => {
    const flat = checked.flat();
    if (flat.length === 0) return "none";
    if (flat.every(Boolean)) return "all";
    if (flat.some(Boolean)) return "some";
    return "none";
  }, [checked]);

  // Update indeterminate on course-level checkbox
  useEffect(() => {
    const el = courseSelectAllRef.current;
    if (!el) return;
    el.indeterminate = courseState === "some";
    el.checked = courseState === "all";
  }, [courseState]);

  // Update indeterminate on segment-level checkboxes
  useEffect(() => {
    segments.forEach((_, si) => {
      const el = segSelectRefs.current[si];
      if (!el) return;
      const s = segState(si);
      el.indeterminate = s === "some";
      el.checked = s === "all";
    });
  });

  // --- Toggle handlers ---
  const toggleAll = () => {
    const toAll = courseState !== "all";
    setChecked(segments.map((seg) => seg.splits.map(() => toAll)));
  };

  const toggleSegment = (si: number) => {
    const toAll = segState(si) !== "all";
    setChecked((prev) =>
      prev.map((cs, i) => (i === si ? cs.map(() => toAll) : cs)),
    );
  };

  const toggleSplit = (si: number, sj: number) => {
    setChecked((prev) =>
      prev.map((cs, i) =>
        i === si ? cs.map((v, j) => (j === sj ? !v : v)) : cs,
      ),
    );
  };

  // --- Derived values ---
  const flatChecked = useMemo(() => checked.flat(), [checked]);
  const totalSplits = flatChecked.length;
  const selectedCount = flatChecked.filter(Boolean).length;
  const anyChecked = selectedCount > 0;

  // Gap: selected splits are non-contiguous in the flat (course-order) list
  const hasGap = useMemo(() => {
    const indices = flatChecked.reduce<number[]>(
      (acc, v, i) => (v ? [...acc, i] : acc),
      [],
    );
    for (let k = 1; k < indices.length; k++) {
      if (indices[k] - indices[k - 1] > 1) return true;
    }
    return false;
  }, [flatChecked]);

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    (unitSystem === "imperial"
      ? Math.round(m * 3.28084)
      : Math.round(m)
    ).toLocaleString();
  const toDistUnit = (km: number) =>
    unitSystem === "imperial" ? km / 1.60934 : km;
  const dLabel = distanceLabel(unitSystem);

  // Aggregate stats across all selected splits
  const aggregates = useMemo(() => {
    let distKmTotal = 0;
    let gainMTotal = 0;
    let lossMTotal = 0;
    segments.forEach((_, si) => {
      (checked[si] ?? []).forEach((v, sj) => {
        if (!v) return;
        const boundary = splitBoundariesKm[si]?.[sj];
        if (boundary) distKmTotal += boundary[1] - boundary[0];
        const profile = gpxProfiles[si]?.[sj];
        if (profile) {
          gainMTotal += profile.elevGainM;
          lossMTotal += profile.elevLossM;
        }
      });
    });
    return { distKmTotal, gainMTotal, lossMTotal };
  }, [checked, segments, splitBoundariesKm, gpxProfiles]);

  const handleExport = useCallback(async () => {
    if (exporting || !anyChecked) return;
    setExporting(true);
    try {
      // Merge selected splits in course order into one continuous track
      const mergedPoints = segments.flatMap((_, si) =>
        (checked[si] ?? []).flatMap((v, sj) => {
          if (!v) return [];
          const boundary = splitBoundariesKm[si]?.[sj];
          if (!boundary) return [];
          return sliceTrackPoints(gpxTrack, boundary[0], boundary[1]);
        }),
      );

      // Collect rest stop and intermediate stop waypoints from selected splits,
      // in course order (intermediate mid-split comes before rest stop at split end).
      const stopWaypoints: GpxWaypoint[] = segments.flatMap((seg, si) =>
        seg.splits.flatMap((split, sj) => {
          if (!checked[si]?.[sj]) return [];
          const boundary = splitBoundariesKm[si]?.[sj];
          const segLabel = seg.name?.trim() || `Segment ${si + 1}`;
          const splitLabel = split.name?.trim() || `Split ${sj + 1}`;
          const waypoints: GpxWaypoint[] = [];

          // Intermediate stop (mid-split) — include first so waypoints follow course order
          const is = split.intermediate_stop;
          if (is?.enabled && is.lat != null && is.lon != null) {
            const snapped =
              boundary && gpxTrack.length > 0
                ? findNearestTrackPoint(
                    gpxTrack,
                    is.lat,
                    is.lon,
                    boundary[0],
                    boundary[1],
                  )
                : null;
            waypoints.push({
              name: `${is.name || "Intermediate Stop"} (${segLabel} / ${splitLabel})`,
              lat: snapped?.lat ?? is.lat,
              lon: snapped?.lon ?? is.lon,
              description: buildRestStopDescription(is as RestStopForm),
              symbol: "food",
            });
          }

          // Rest stop (split end)
          const rs = split.rest_stop;
          if (rs.enabled && rs.lat != null && rs.lon != null) {
            const snapped =
              boundary && gpxTrack.length > 0
                ? findNearestTrackPoint(
                    gpxTrack,
                    rs.lat,
                    rs.lon,
                    boundary[0],
                    boundary[1],
                  )
                : null;
            waypoints.push({
              name: `${rs.name} (${segLabel} / ${splitLabel})`,
              lat: snapped?.lat ?? rs.lat,
              lon: snapped?.lon ?? rs.lon,
              description: buildRestStopDescription(rs),
              symbol: "food",
            });
          }

          return waypoints;
        }),
      );

      const trackName = defaultFileName.trim() || "Course";
      const safeFileName = trackName.replace(/[^a-z0-9_\-. ]/gi, "_");
      const allWaypoints = [
        ...stopWaypoints,
        ...(gpxWaypoints ?? []),
        ...(includeRwgpsPois ? (rwgpsPois ?? []) : []),
        ...(includeRwgpsCoursePoints ? (rwgpsCoursePoints ?? []) : []),
      ];
      const gpx = buildGpxString(
        [{ name: trackName, points: mergedPoints }],
        trackName,
        allWaypoints,
      );
      const blob = new Blob([gpx], { type: "application/gpx+xml" });

      if ("showOpenFilePicker" in self) {
        try {
          const handle = await (
            window as Window &
              typeof globalThis & {
                showSaveFilePicker: (
                  opts: unknown,
                ) => Promise<FileSystemFileHandle>;
              }
          ).showSaveFilePicker({
            suggestedName: `${safeFileName}.gpx`,
            startIn: "downloads",
            types: [
              {
                description: "GPX File",
                accept: { "application/gpx+xml": [".gpx"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Unexpected error — fall through to legacy download.
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [
    exporting,
    anyChecked,
    segments,
    checked,
    splitBoundariesKm,
    gpxTrack,
    defaultFileName,
    gpxWaypoints,
    rwgpsPois,
    rwgpsCoursePoints,
    includeRwgpsPois,
    includeRwgpsCoursePoints,
  ]);

  return (
    <dialog ref={dialogRef} className="gpx-export-modal" onClose={onClose}>
      <div className="gpx-export-header">
        <h2>Export GPX Splits</h2>
        <button
          className="legend-close"
          onClick={onClose}
          aria-label="Close"
          type="button"
        >
          ✕
        </button>
      </div>

      <div className="gpx-export-body">
        <p className="gpx-export-hint">
          Select splits to include. Selected splits are merged into a single
          continuous track for GPS and route importer compatibility. Rest stops
          with valid coordinates are added as waypoints, snapped to the nearest
          track point within each split.
        </p>

        <table className="gpx-export-table">
          <thead>
            <tr>
              <th>
                <input
                  ref={courseSelectAllRef}
                  type="checkbox"
                  aria-label="Select all splits"
                  onChange={toggleAll}
                />
              </th>
              <th>Split</th>
              <th>Distance</th>
              <th>Elev ↑</th>
              <th>Elev ↓</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg, si) => {
              const segLabel = seg.name?.trim() || `Segment ${si + 1}`;
              return (
                <>
                  {/* Segment header row */}
                  <tr
                    key={`seg-${si}`}
                    className="gpx-export-row-segment"
                    onClick={() => toggleCollapsed(si)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={(el) => {
                          segSelectRefs.current[si] = el;
                        }}
                        type="checkbox"
                        aria-label={`Select all splits in ${segLabel}`}
                        onChange={() => toggleSegment(si)}
                        defaultChecked
                      />
                    </td>
                    <td className="gpx-export-seg-name" colSpan={4}>
                      <span
                        className="gpx-export-seg-chevron"
                        style={{
                          color: SEGMENT_COLORS[si % SEGMENT_COLORS.length],
                        }}
                      >
                        <i
                          className={`fas fa-chevron-${collapsed[si] ? "right" : "down"}`}
                        />
                      </span>
                      {segLabel}
                    </td>
                  </tr>

                  {/* Split rows — hidden when segment is collapsed */}
                  {!collapsed[si] &&
                    seg.splits.map((split, sj) => {
                      const boundary = splitBoundariesKm[si]?.[sj];
                      const distKm = boundary
                        ? boundary[1] - boundary[0]
                        : null;
                      const profile = gpxProfiles[si]?.[sj];
                      const label = split.name?.trim() || `Split ${sj + 1}`;
                      return (
                        <tr
                          key={`split-${si}-${sj}`}
                          className={`gpx-export-row-split${checked[si]?.[sj] ? " gpx-export-row-checked" : ""}`}
                          onClick={() => toggleSplit(si, sj)}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={checked[si]?.[sj] ?? false}
                              onChange={() => toggleSplit(si, sj)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Include ${label}`}
                            />
                          </td>
                          <td className="gpx-export-split-name gpx-export-split-name--indented">
                            {label}
                          </td>
                          <td>
                            {distKm != null
                              ? `${toDistUnit(distKm).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${dLabel}`
                              : "—"}
                          </td>
                          <td className="gpx-export-gain">
                            {profile
                              ? `${toElevUnit(profile.elevGainM)} ${elevUnit}`
                              : "—"}
                          </td>
                          <td className="gpx-export-loss">
                            {profile
                              ? `${toElevUnit(profile.elevLossM)} ${elevUnit}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                </>
              );
            })}
          </tbody>
        </table>

        {hasGap && (
          <div className="gpx-export-gap-warning" role="alert">
            ⚠ Non-adjacent splits selected — the exported track will contain a
            positional jump where skipped splits would have been. GPS devices
            and route importers may show this as a straight-line connector.
          </div>
        )}

        {((rwgpsPois && rwgpsPois.length > 0) ||
          (rwgpsCoursePoints && rwgpsCoursePoints.length > 0)) && (
          <div className="gpx-export-waypoints-section">
            <span className="gpx-export-waypoints-label">
              RideWithGPS waypoints
            </span>
            {rwgpsPois && rwgpsPois.length > 0 && (
              <label className="gpx-export-waypoints-toggle">
                <input
                  type="checkbox"
                  checked={includeRwgpsPois}
                  onChange={(e) => setIncludeRwgpsPois(e.target.checked)}
                />
                Points of Interest ({rwgpsPois.length})
              </label>
            )}
            {rwgpsCoursePoints && rwgpsCoursePoints.length > 0 && (
              <label className="gpx-export-waypoints-toggle">
                <input
                  type="checkbox"
                  checked={includeRwgpsCoursePoints}
                  onChange={(e) =>
                    setIncludeRwgpsCoursePoints(e.target.checked)
                  }
                />
                Course Points ({rwgpsCoursePoints.length})
              </label>
            )}
          </div>
        )}
      </div>

      <div className="gpx-export-footer">
        <div className="gpx-export-footer-info">
          <span className="gpx-export-count">
            {selectedCount} of {totalSplits} splits selected
          </span>
          {anyChecked ? (
            <span className="gpx-export-aggregates">
              <span>
                {toDistUnit(aggregates.distKmTotal).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {dLabel}
              </span>
              <span className="gpx-export-gain">
                ↑ {toElevUnit(aggregates.gainMTotal)} {elevUnit}
              </span>
              <span className="gpx-export-loss">
                ↓ {toElevUnit(aggregates.lossMTotal)} {elevUnit}
              </span>
            </span>
          ) : (
            <span className="gpx-export-aggregates gpx-export-aggregates--empty">
              No splits selected
            </span>
          )}
        </div>
        <button
          type="button"
          className={`action-btn action-btn-export${exporting ? " nav-btn-loading" : ""}`}
          onClick={handleExport}
          disabled={exporting || !anyChecked}
        >
          {exporting ? (
            <>
              <span className="btn-spinner" /> Saving…
            </>
          ) : (
            <>
              <i className="fa-solid fa-floppy-disk" /> Save
            </>
          )}
        </button>
      </div>
    </dialog>
  );
}
