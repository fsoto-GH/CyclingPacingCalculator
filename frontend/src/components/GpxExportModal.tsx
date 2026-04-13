import { useEffect, useRef, useState, useCallback } from "react";
import type {
  GpxTrackPoint,
  SplitGpxProfile,
  SplitForm as SplitFormType,
  UnitSystem,
} from "../types";
import { sliceTrackPoints, buildGpxString } from "../calculator/gpxParser";
import { distanceLabel } from "../utils";

interface GpxExportModalProps {
  open: boolean;
  onClose: () => void;
  segIndex: number;
  segName?: string;
  splits: SplitFormType[];
  gpxTrack: GpxTrackPoint[];
  splitBoundariesKm: [number, number][];
  gpxProfiles: SplitGpxProfile[];
  unitSystem: UnitSystem;
}

export default function GpxExportModal({
  open,
  onClose,
  segIndex,
  segName,
  splits,
  gpxTrack,
  splitBoundariesKm,
  gpxProfiles,
  unitSystem,
}: GpxExportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<boolean[]>(() =>
    splits.map(() => true),
  );
  const [exporting, setExporting] = useState(false);
  const defaultName = segName?.trim() || `Segment ${segIndex + 1}`;
  const [fileName, setFileName] = useState(defaultName);

  // Keep filename in sync if the segment name/index changes while modal is open
  useEffect(() => {
    setFileName(segName?.trim() || `Segment ${segIndex + 1}`);
  }, [segName, segIndex]);

  // Re-init checked array when split count changes
  useEffect(() => {
    setChecked(splits.map(() => true));
  }, [splits.length]);

  // Open/close the native dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Update indeterminate state on select-all checkbox
  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const all = checked.every(Boolean);
    const none = checked.every((v) => !v);
    el.indeterminate = !all && !none;
    el.checked = all;
  }, [checked]);

  const allChecked = checked.every(Boolean);
  const anyChecked = checked.some(Boolean);

  // True when checked splits have at least one unchecked gap between them,
  // e.g. splits 1 and 3 selected but not 2. The merged track will have a
  // positional jump at that gap.
  const hasGap = (() => {
    const indices = checked.reduce<number[]>(
      (acc, v, i) => (v ? [...acc, i] : acc),
      [],
    );
    for (let k = 1; k < indices.length; k++) {
      if (indices[k] - indices[k - 1] > 1) return true;
    }
    return false;
  })();

  const toggleAll = () => setChecked(checked.map(() => !allChecked));
  const toggleOne = (i: number) =>
    setChecked(checked.map((v, j) => (j === i ? !v : v)));

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    (unitSystem === "imperial"
      ? Math.round(m * 3.28084)
      : Math.round(m)
    ).toLocaleString();
  const toDistUnit = (km: number) =>
    unitSystem === "imperial" ? km / 1.60934 : km;
  const dLabel = distanceLabel(unitSystem);

  // Aggregate stats for selected splits
  const aggregates = (() => {
    let distKmTotal = 0;
    let gainMTotal = 0;
    let lossMTotal = 0;
    splits.forEach((_, j) => {
      if (!checked[j]) return;
      const boundary = splitBoundariesKm[j];
      if (boundary) distKmTotal += boundary[1] - boundary[0];
      const profile = gpxProfiles[j];
      if (profile) {
        gainMTotal += profile.elevGainM;
        lossMTotal += profile.elevLossM;
      }
    });
    return { distKmTotal, gainMTotal, lossMTotal };
  })();

  const handleExport = useCallback(() => {
    if (exporting || !anyChecked) return;
    setExporting(true);
    setTimeout(() => {
      try {
        // Collect points from all selected splits in order and merge into
        // one continuous track (single <trkseg>) so importers like Garmin
        // treat it as one route.
        const mergedPoints = splits.flatMap((_, j) => {
          if (!checked[j]) return [];
          const boundary = splitBoundariesKm[j];
          if (!boundary) return [];
          return sliceTrackPoints(gpxTrack, boundary[0], boundary[1]);
        });

        const trackName = fileName.trim() || defaultName;
        const gpx = buildGpxString(
          [{ name: trackName, points: mergedPoints }],
          trackName,
        );
        const blob = new Blob([gpx], { type: "application/gpx+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${trackName.replace(/[^a-z0-9_\-. ]/gi, "_")}.gpx`;
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        setExporting(false);
      }
    }, 0);
  }, [
    exporting,
    anyChecked,
    splits,
    checked,
    splitBoundariesKm,
    gpxTrack,
    fileName,
    defaultName,
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
          Select which splits to include. All selected splits will be merged
          into a single continuous track, making them compatible with GPS
          devices and route importers.
        </p>

        <table className="gpx-export-table">
          <thead>
            <tr>
              <th>
                <input
                  ref={selectAllRef}
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
            {splits.map((split, j) => {
              const boundary = splitBoundariesKm[j];
              const distKm = boundary ? boundary[1] - boundary[0] : null;
              const distDisplay =
                distKm != null
                  ? `${toDistUnit(distKm).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${dLabel}`
                  : "—";
              const profile = gpxProfiles[j];
              const gainDisplay = profile
                ? `${toElevUnit(profile.elevGainM)} ${elevUnit}`
                : "—";
              const lossDisplay = profile
                ? `${toElevUnit(profile.elevLossM)} ${elevUnit}`
                : "—";
              const label = split.name?.trim() || `Split ${j + 1}`;

              return (
                <tr
                  key={j}
                  className={checked[j] ? "gpx-export-row-checked" : ""}
                  onClick={() => toggleOne(j)}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={checked[j] ?? false}
                      onChange={() => toggleOne(j)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Include ${label}`}
                    />
                  </td>
                  <td className="gpx-export-split-name">{label}</td>
                  <td>{distDisplay}</td>
                  <td className="gpx-export-gain">{gainDisplay}</td>
                  <td className="gpx-export-loss">{lossDisplay}</td>
                </tr>
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
      </div>

      <div className="gpx-export-footer">
        <div className="gpx-export-footer-info">
          <span className="gpx-export-count">
            {checked.filter(Boolean).length} of {splits.length} splits selected
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
          <div className="gpx-export-filename-row">
            <label
              htmlFor="gpx-export-filename"
              className="gpx-export-filename-label"
            >
              File name
            </label>
            <input
              id="gpx-export-filename"
              className="gpx-export-filename-input"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              spellCheck={false}
              placeholder={defaultName}
            />
            <span className="gpx-export-ext">.gpx</span>
          </div>
        </div>
        <button
          type="button"
          className={`action-btn action-btn-export${exporting ? " nav-btn-loading" : ""}`}
          onClick={handleExport}
          disabled={exporting || !anyChecked}
        >
          {exporting ? (
            <>
              <span className="btn-spinner" /> Exporting…
            </>
          ) : (
            "Export"
          )}
        </button>
      </div>
    </dialog>
  );
}
