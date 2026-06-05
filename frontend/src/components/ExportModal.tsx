import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import type {
  CourseForm as CourseFormState,
  CourseDetail,
  GpxTrackPoint,
  GpxWaypoint,
  SplitGpxProfile,
} from "../types";
import {
  type CueSheetOptions,
  type CueSheetData,
  generateCueSheetHtml,
} from "../calculator/cueSheetGenerator";

// ── All 39 RwGPS POI types ──────────────────────────────────────────────────
const RWGPS_POI_TYPES: { type: string; label: string }[] = [
  // Should be sorted alphabetically by label, and the type should match the description in the GPX file.
  { type: "aid_station", label: "Aid Station" },
  { type: "atm", label: "ATM" },
  { type: "bar", label: "Bar" },
  { type: "bikeshare", label: "Bike Share" },
  { type: "bike_parking", label: "Bike Parking" },
  { type: "bike_shop", label: "Bike Shop" },
  { type: "camping", label: "Camping" },
  { type: "caution", label: "Caution" },
  { type: "coffee", label: "Coffee" },
  { type: "control", label: "Control" },
  { type: "convenience_store", label: "Convenience Store" },
  { type: "ferry", label: "Ferry" },
  { type: "finish", label: "Finish" },
  { type: "first_aid", label: "First Aid" },
  { type: "food", label: "Food" },
  { type: "gas", label: "Gas Station" },
  { type: "geocache", label: "Geocache" },
  { type: "generic", label: "Generic" },
  { type: "hospital", label: "Hospital" },
  { type: "library", label: "Library" },
  { type: "lodging", label: "Lodging" },
  { type: "monument", label: "Monument" },
  { type: "park", label: "Park" },
  { type: "parking", label: "Parking" },
  { type: "rest_stop", label: "Rest Stop" },
  { type: "restroom", label: "Restroom" },
  { type: "segment_end", label: "Segment End" },
  { type: "segment_start", label: "Segment Start" },
  { type: "shopping", label: "Shopping" },
  { type: "shower", label: "Shower" },
  { type: "start", label: "Start" },
  { type: "stop", label: "Stop" },
  { type: "summit", label: "Summit" },
  { type: "swimming", label: "Swimming" },
  { type: "transit", label: "Transit Center" },
  { type: "trailhead", label: "Trailhead" },
  { type: "viewpoint", label: "Viewpoint" },
  { type: "water", label: "Water" },
  { type: "winery", label: "Winery" },
];

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing JSON export logic from CourseForm */
  onExportJson: () => Promise<void>;
  jsonExportDisabled: boolean;
  form: CourseFormState;
  result: CourseDetail | null;
  splitBoundariesKm: ([number, number] | undefined)[][] | null;
  gpxTrack: GpxTrackPoint[];
  gpxProfiles: SplitGpxProfile[][] | null;
  rwgpsPois: GpxWaypoint[];
  rwgpsCoursePoints: GpxWaypoint[];
}

type Tab = "json" | "cuesheet";

export default function ExportModal({
  open,
  onClose,
  onExportJson,
  jsonExportDisabled,
  form,
  result,
  splitBoundariesKm,
  gpxTrack,
  gpxProfiles,
  rwgpsPois,
  rwgpsCoursePoints,
}: ExportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // ── Tab ──
  const [tab, setTab] = useState<Tab>("json");

  // ── Top-level cue sheet options ──
  const [compact, setCompact] = useState(false);
  const [mileMarkerDirection, setMileMarkerDirection] = useState<
    "from-start" | "from-end"
  >("from-start");
  const [includeSplitDistance, setIncludeSplitDistance] = useState(true);
  const [includeEta, setIncludeEta] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeElevation, setIncludeElevation] = useState(false);

  // ── Intermediate stop accordion ──
  const [includeIntermediateStop, setIncludeIntermediateStop] = useState(true);
  const [intermediateExpanded, setIntermediateExpanded] = useState(false);
  const [intermediateIncludeHours, setIntermediateIncludeHours] =
    useState(true);
  const [intermediateIncludeEta, setIntermediateIncludeEta] = useState(true);

  // ── Rest stop accordion ──
  const [includeRestStop, setIncludeRestStop] = useState(true);
  const [restStopExpanded, setRestStopExpanded] = useState(false);
  const [restStopIncludeHours, setRestStopIncludeHours] = useState(true);
  const [restStopIncludeEta, setRestStopIncludeEta] = useState(true);

  // ── Course points accordion ──
  const [includeControls, setIncludeControls] = useState(true);
  const [includeCoursePoints, setIncludeCoursePoints] = useState(false);
  const [cueTypesExpanded, setCueTypesExpanded] = useState(false);
  const [selectedCueTypes, setSelectedCueTypes] = useState<Set<string>>(
    () => new Set(),
  );

  // ── POI accordion ──
  const [includePois, setIncludePois] = useState(false);
  const [poisExpanded, setPoisExpanded] = useState(false);
  const [selectedPoiTypes, setSelectedPoiTypes] = useState<Set<string>>(
    () => new Set(),
  );

  // ── Derived data ──

  const availableCueTypes = useMemo<{ type: string; count: number }[]>(() => {
    const counts = new Map<string, number>();
    for (const cp of rwgpsCoursePoints) {
      const t = cp.description?.trim() || "(no type)";
      // 'control' is handled by the separate Controls checkbox
      if (t.toLowerCase() === "control") continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }, [rwgpsCoursePoints]);

  const hasControlPoints = useMemo(
    () =>
      rwgpsCoursePoints.some(
        (cp) => cp.description?.trim().toLowerCase() === "control",
      ),
    [rwgpsCoursePoints],
  );

  const poiCounts = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const poi of rwgpsPois) {
      const t = poi.poiType ?? "";
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }, [rwgpsPois]);

  // Seed selectedCueTypes when source data changes (exclude controls)
  const prevCoursePointsRef = useRef(rwgpsCoursePoints);
  useEffect(() => {
    if (rwgpsCoursePoints !== prevCoursePointsRef.current) {
      prevCoursePointsRef.current = rwgpsCoursePoints;
      setSelectedCueTypes(
        new Set(
          rwgpsCoursePoints
            .filter((cp) => cp.description?.trim().toLowerCase() !== "control")
            .map((cp) => cp.description?.trim() || "(no type)"),
        ),
      );
    }
  }, [rwgpsCoursePoints]);

  const prevPoisRef = useRef(rwgpsPois);
  useEffect(() => {
    if (rwgpsPois !== prevPoisRef.current) {
      prevPoisRef.current = rwgpsPois;
      setSelectedPoiTypes(new Set(rwgpsPois.map((p) => p.poiType ?? "")));
    }
  }, [rwgpsPois]);

  // ── Open / close native dialog ──
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // ── Validation ──
  const hasCoursePoints = rwgpsCoursePoints.length > 0;
  const hasPois = rwgpsPois.length > 0;
  const hasGpxProfiles =
    gpxProfiles != null &&
    gpxProfiles.some((seg) => seg.some((p) => p != null));
  const cuesheetReady = result != null && splitBoundariesKm != null;

  const cueSectionError =
    !compact &&
    includeCoursePoints &&
    hasCoursePoints &&
    selectedCueTypes.size === 0;
  const poiSectionError =
    !compact && includePois && hasPois && selectedPoiTypes.size === 0;
  const hasExportErrors = cueSectionError || poiSectionError;

  // ── JSON export ──
  const [jsonExporting, setJsonExporting] = useState(false);
  const handleJsonDownload = useCallback(async () => {
    if (jsonExportDisabled || jsonExporting) return;
    setJsonExporting(true);
    try {
      await onExportJson();
    } finally {
      setJsonExporting(false);
    }
  }, [jsonExportDisabled, jsonExporting, onExportJson]);

  // ── Cue sheet generation ──
  const buildOptions = useCallback(
    (): CueSheetOptions => ({
      mileMarkerDirection,
      includeSplitDistance,
      includeEta,
      includeNotes,
      includeElevation: !compact && includeElevation,
      compact,
      includeControls: includeControls && hasControlPoints,
      includeIntermediateStop,
      intermediateIncludeHours,
      intermediateIncludeEta,
      includeRestStop,
      restStopIncludeHours,
      restStopIncludeEta,
      includeCoursePoints: !compact && includeCoursePoints,
      selectedCueTypes,
      includePois: !compact && includePois,
      selectedPoiTypes,
      unitSystem: form.unitSystem,
    }),
    [
      mileMarkerDirection,
      includeSplitDistance,
      includeEta,
      includeNotes,
      includeElevation,
      compact,
      includeControls,
      includeIntermediateStop,
      intermediateIncludeHours,
      intermediateIncludeEta,
      includeRestStop,
      restStopIncludeHours,
      restStopIncludeEta,
      includeCoursePoints,
      selectedCueTypes,
      includePois,
      selectedPoiTypes,
      form.unitSystem,
    ],
  );

  const buildData = useCallback((): CueSheetData | null => {
    if (!result || !splitBoundariesKm) return null;
    return {
      form,
      result,
      splitBoundariesKm,
      gpxTrack,
      gpxProfiles,
      rwgpsCoursePoints,
      rwgpsPois,
      courseTz: form.timezone,
    };
  }, [
    form,
    result,
    splitBoundariesKm,
    gpxTrack,
    gpxProfiles,
    rwgpsCoursePoints,
    rwgpsPois,
  ]);

  const handleDownloadHtml = useCallback(() => {
    const data = buildData();
    if (!data || hasExportErrors) return;
    const html = generateCueSheetHtml(buildOptions(), data);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cuesheet-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildData, buildOptions, hasExportErrors]);

  const handleOpenForPrint = useCallback(() => {
    const data = buildData();
    if (!data || hasExportErrors) return;
    const html = generateCueSheetHtml(buildOptions(), data);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
  }, [buildData, buildOptions, hasExportErrors]);

  // ── Helpers ──
  const toggleCueType = (type: string) =>
    setSelectedCueTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const togglePoiType = (type: string) =>
    setSelectedPoiTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const enabledPoiTypes = RWGPS_POI_TYPES.filter(
    ({ type }) => (poiCounts.get(type) ?? 0) > 0,
  );

  return (
    <dialog ref={dialogRef} className="export-modal" onClose={onClose}>
      {/* ── Header ── */}
      <div className="export-modal-header">
        <div className="export-modal-tabs">
          <button
            type="button"
            className={`export-modal-tab${tab === "json" ? " export-modal-tab--active" : ""}`}
            onClick={() => setTab("json")}
          >
            <i className="fa-solid fa-file-code" /> Course JSON
          </button>
          <button
            type="button"
            className={`export-modal-tab${tab === "cuesheet" ? " export-modal-tab--active" : ""}`}
            onClick={() => setTab("cuesheet")}
          >
            <i className="fa-solid fa-list-ol" /> Cue Sheet
          </button>
        </div>
        <button
          className="legend-close"
          onClick={onClose}
          aria-label="Close"
          type="button"
        >
          ✕
        </button>
      </div>

      {/* ── Body ── */}
      <div className="export-modal-body">
        {/* ── JSON Tab ── */}
        {tab === "json" && (
          <div className="export-modal-section">
            <p className="export-modal-hint">
              Download the current course configuration as a JSON file. You can
              re-import it later to restore all segments, splits, and settings.
            </p>
            <button
              type="button"
              className={`action-btn action-btn-export${jsonExporting ? " nav-btn-loading" : ""}`}
              onClick={handleJsonDownload}
              disabled={jsonExportDisabled || jsonExporting}
              title={
                jsonExportDisabled
                  ? "Fix validation errors before exporting"
                  : "Download course configuration as JSON"
              }
            >
              {jsonExporting ? (
                <>
                  <span className="btn-spinner" /> Saving…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-file-export" /> Download JSON
                </>
              )}
            </button>
          </div>
        )}

        {/* ── Cue Sheet Tab ── */}
        {tab === "cuesheet" && (
          <div className="export-modal-section">
            {!cuesheetReady ? (
              <p className="export-modal-hint export-modal-hint--disabled">
                <i className="fa-solid fa-circle-info" /> Calculate the course
                first to generate a cue sheet.
              </p>
            ) : (
              <>
                {/* Compact mode toggle */}
                <div className="export-compact-row">
                  <label className="export-compact-label">
                    <input
                      type="checkbox"
                      checked={compact}
                      onChange={(e) => setCompact(e.target.checked)}
                    />
                    <span>Compact mode</span>
                  </label>
                  {compact && (
                    <span className="export-compact-desc">
                      Color-coded list — one entry per stop/split. Cues and POIs
                      are excluded.
                    </span>
                  )}
                </div>

                {/* Mile marker direction */}
                <div className="export-option-row">
                  <span className="export-option-label">Mile marker</span>
                  <div className="export-radio-group">
                    <label className="export-radio-label">
                      <input
                        type="radio"
                        name="mileMarkerDir"
                        value="from-start"
                        checked={mileMarkerDirection === "from-start"}
                        onChange={() => setMileMarkerDirection("from-start")}
                      />
                      From start
                    </label>
                    <label className="export-radio-label">
                      <input
                        type="radio"
                        name="mileMarkerDir"
                        value="from-end"
                        checked={mileMarkerDirection === "from-end"}
                        onChange={() => setMileMarkerDirection("from-end")}
                      />
                      From end
                    </label>
                  </div>
                </div>

                {/* Simple toggles */}
                <div className="export-option-row">
                  <label className="export-toggle-label">
                    <input
                      type="checkbox"
                      checked={includeSplitDistance}
                      onChange={(e) =>
                        setIncludeSplitDistance(e.target.checked)
                      }
                    />
                    Split Distance
                  </label>
                </div>
                <div className="export-option-row">
                  <label className="export-toggle-label">
                    <input
                      type="checkbox"
                      checked={includeEta}
                      onChange={(e) => setIncludeEta(e.target.checked)}
                    />
                    ETA
                  </label>
                </div>
                <div className="export-option-row">
                  <label className="export-toggle-label">
                    <input
                      type="checkbox"
                      checked={includeNotes}
                      onChange={(e) => setIncludeNotes(e.target.checked)}
                    />
                    Split Notes
                  </label>
                </div>
                <div className="export-option-row">
                  <label
                    className={`export-toggle-label${
                      !hasControlPoints ? " export-toggle-label--muted" : ""
                    }`}
                    title="A control is a designated checkpoint along the route with required check-in"
                  >
                    <input
                      type="checkbox"
                      checked={includeControls}
                      disabled={!hasControlPoints}
                      onChange={(e) => setIncludeControls(e.target.checked)}
                    />
                    Controls
                    {!hasControlPoints && (
                      <span className="export-no-data">(no controls)</span>
                    )}
                  </label>
                </div>
                <div className="export-option-row">
                  <label
                    className={`export-toggle-label${
                      compact || !hasGpxProfiles
                        ? " export-toggle-label--muted"
                        : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={includeElevation}
                      disabled={compact || !hasGpxProfiles}
                      onChange={(e) => setIncludeElevation(e.target.checked)}
                    />
                    Split Elevation
                    {!hasGpxProfiles && (
                      <span className="export-no-data">(no GPX loaded)</span>
                    )}
                    {compact && hasGpxProfiles && (
                      <span className="export-no-data">(table mode only)</span>
                    )}
                  </label>
                </div>

                {/* ── Intermediate Stop accordion (before rest stop) ── */}
                <div className="export-accordion">
                  <div className="export-accordion-header">
                    <label className="export-toggle-label">
                      <input
                        type="checkbox"
                        checked={includeIntermediateStop}
                        onChange={(e) => {
                          setIncludeIntermediateStop(e.target.checked);
                          if (e.target.checked) setIntermediateExpanded(true);
                        }}
                      />
                      Intermediate Stop
                    </label>
                    {includeIntermediateStop && (
                      <button
                        type="button"
                        className="export-accordion-toggle"
                        onClick={() => setIntermediateExpanded((v) => !v)}
                        aria-label={
                          intermediateExpanded ? "Collapse" : "Expand"
                        }
                      >
                        <i
                          className={`fas fa-chevron-${intermediateExpanded ? "up" : "down"}`}
                        />
                      </button>
                    )}
                  </div>
                  {includeIntermediateStop && intermediateExpanded && (
                    <div className="export-accordion-body">
                      <p className="export-accordion-note">
                        Mile marker and name are always included.
                      </p>
                      <label className="export-toggle-label">
                        <input
                          type="checkbox"
                          checked={intermediateIncludeHours}
                          onChange={(e) =>
                            setIntermediateIncludeHours(e.target.checked)
                          }
                        />
                        Hours for ETA day
                      </label>
                      <label className="export-toggle-label">
                        <input
                          type="checkbox"
                          checked={intermediateIncludeEta}
                          onChange={(e) =>
                            setIntermediateIncludeEta(e.target.checked)
                          }
                        />
                        ETA
                      </label>
                    </div>
                  )}
                </div>

                {/* ── Rest Stop accordion ── */}
                <div className="export-accordion">
                  <div className="export-accordion-header">
                    <label className="export-toggle-label">
                      <input
                        type="checkbox"
                        checked={includeRestStop}
                        onChange={(e) => {
                          setIncludeRestStop(e.target.checked);
                          if (e.target.checked) setRestStopExpanded(true);
                        }}
                      />
                      Rest Stop Details
                    </label>
                    {includeRestStop && (
                      <button
                        type="button"
                        className="export-accordion-toggle"
                        onClick={() => setRestStopExpanded((v) => !v)}
                        aria-label={restStopExpanded ? "Collapse" : "Expand"}
                      >
                        <i
                          className={`fas fa-chevron-${restStopExpanded ? "up" : "down"}`}
                        />
                      </button>
                    )}
                  </div>
                  {includeRestStop && restStopExpanded && (
                    <div className="export-accordion-body">
                      <p className="export-accordion-note">
                        Name is always included. Mile marker is omitted — rest
                        stops are always at the split endpoint.
                      </p>
                      <label className="export-toggle-label">
                        <input
                          type="checkbox"
                          checked={restStopIncludeHours}
                          onChange={(e) =>
                            setRestStopIncludeHours(e.target.checked)
                          }
                        />
                        Hours for ETA day
                      </label>
                      <label className="export-toggle-label">
                        <input
                          type="checkbox"
                          checked={restStopIncludeEta}
                          onChange={(e) =>
                            setRestStopIncludeEta(e.target.checked)
                          }
                        />
                        ETA
                      </label>
                    </div>
                  )}
                </div>

                {/* ── Course Points accordion ── */}
                <div
                  className={`export-accordion${!hasCoursePoints || compact ? " export-accordion--disabled" : ""}`}
                >
                  <div className="export-accordion-header">
                    <label
                      className="export-toggle-label"
                      title="Course points are points directly on the route, often used for cueing. They are distinct from POIs, which may be off-route."
                    >
                      <input
                        type="checkbox"
                        checked={includeCoursePoints}
                        disabled={!hasCoursePoints || compact}
                        onChange={(e) => {
                          setIncludeCoursePoints(e.target.checked);
                          if (e.target.checked) setCueTypesExpanded(true);
                        }}
                      />
                      Course Points (Cues)
                      {!hasCoursePoints && (
                        <span className="export-no-data">
                          (no RwGPS route loaded)
                        </span>
                      )}
                      {compact && hasCoursePoints && (
                        <span className="export-no-data">
                          (disabled in compact mode)
                        </span>
                      )}
                    </label>
                    {hasCoursePoints && !compact && includeCoursePoints && (
                      <button
                        type="button"
                        className="export-accordion-toggle"
                        onClick={() => setCueTypesExpanded((v) => !v)}
                        aria-label={cueTypesExpanded ? "Collapse" : "Expand"}
                      >
                        <i
                          className={`fas fa-chevron-${cueTypesExpanded ? "up" : "down"}`}
                        />
                      </button>
                    )}
                  </div>
                  {hasCoursePoints &&
                    !compact &&
                    includeCoursePoints &&
                    cueTypesExpanded && (
                      <div className="export-accordion-body">
                        <div className="export-grid-header">
                          <button
                            type="button"
                            className="export-select-all-btn"
                            onClick={() =>
                              setSelectedCueTypes(
                                selectedCueTypes.size ===
                                  availableCueTypes.length
                                  ? new Set()
                                  : new Set(
                                      availableCueTypes.map((c) => c.type),
                                    ),
                              )
                            }
                          >
                            {selectedCueTypes.size === availableCueTypes.length
                              ? "Deselect all"
                              : "Select all"}
                          </button>
                        </div>
                        <div className="export-checkbox-grid">
                          {availableCueTypes.map(({ type, count }) => (
                            <label key={type} className="export-toggle-label">
                              <input
                                type="checkbox"
                                checked={selectedCueTypes.has(type)}
                                onChange={() => toggleCueType(type)}
                              />
                              {type}
                              <span className="export-count-badge">
                                ({count})
                              </span>
                            </label>
                          ))}
                        </div>
                        {cueSectionError && (
                          <p className="export-section-error">
                            <i className="fa-solid fa-triangle-exclamation" />{" "}
                            Select at least one cue type.
                          </p>
                        )}
                      </div>
                    )}
                  {/* Error shown even when accordion is collapsed */}
                  {cueSectionError && !cueTypesExpanded && (
                    <p className="export-section-error export-section-error--outside">
                      <i className="fa-solid fa-triangle-exclamation" /> Select
                      at least one cue type.
                    </p>
                  )}
                </div>

                {/* ── Points of Interest accordion ── */}
                <div
                  className={`export-accordion${!hasPois || compact ? " export-accordion--disabled" : ""}`}
                >
                  <div className="export-accordion-header">
                    <label
                      className="export-toggle-label"
                      title="Points of Interest (POIs) are distinct from course points (cues) — they may be off-route and are often used for reference or navigation landmarks rather than specific instructions."
                    >
                      <input
                        type="checkbox"
                        checked={includePois}
                        disabled={!hasPois || compact}
                        onChange={(e) => {
                          setIncludePois(e.target.checked);
                          if (e.target.checked) setPoisExpanded(true);
                        }}
                      />
                      Points of Interest
                      {!hasPois && (
                        <span className="export-no-data">
                          (no RwGPS route loaded)
                        </span>
                      )}
                      {compact && hasPois && (
                        <span className="export-no-data">
                          (disabled in compact mode)
                        </span>
                      )}
                    </label>
                    {hasPois && !compact && includePois && (
                      <button
                        type="button"
                        className="export-accordion-toggle"
                        onClick={() => setPoisExpanded((v) => !v)}
                        aria-label={poisExpanded ? "Collapse" : "Expand"}
                      >
                        <i
                          className={`fas fa-chevron-${poisExpanded ? "up" : "down"}`}
                        />
                      </button>
                    )}
                  </div>
                  {hasPois && !compact && includePois && poisExpanded && (
                    <div className="export-accordion-body">
                      <div className="export-grid-header">
                        <button
                          type="button"
                          className="export-select-all-btn"
                          onClick={() => {
                            setSelectedPoiTypes(
                              selectedPoiTypes.size === enabledPoiTypes.length
                                ? new Set()
                                : new Set(enabledPoiTypes.map((t) => t.type)),
                            );
                          }}
                        >
                          {selectedPoiTypes.size === enabledPoiTypes.length
                            ? "Deselect all"
                            : "Select all"}
                        </button>
                      </div>
                      <div className="export-checkbox-grid">
                        {RWGPS_POI_TYPES.map(({ type, label }) => {
                          const count = poiCounts.get(type) ?? 0;
                          return (
                            <label
                              key={type}
                              className={`export-toggle-label${count === 0 ? " export-toggle-label--muted" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedPoiTypes.has(type)}
                                disabled={count === 0}
                                onChange={() => togglePoiType(type)}
                              />
                              {label}
                              {count > 0 && (
                                <span className="export-count-badge">
                                  ({count})
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      {poiSectionError && (
                        <p className="export-section-error">
                          <i className="fa-solid fa-triangle-exclamation" />{" "}
                          Select at least one POI type.
                        </p>
                      )}
                    </div>
                  )}
                  {poiSectionError && !poisExpanded && (
                    <p className="export-section-error export-section-error--outside">
                      <i className="fa-solid fa-triangle-exclamation" /> Select
                      at least one POI type.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="export-modal-footer">
        {tab === "json" && (
          <span className="export-modal-footer-note">
            Saved JSON can be re-imported to restore this course.
          </span>
        )}
        {tab === "cuesheet" && cuesheetReady && (
          <>
            <span className="export-modal-footer-note">
              {compact
                ? "Color key: green = start, red = end, blue = intermediate, amber = transit."
                : "Name and mile marker are always included per split."}
            </span>
            <div className="export-modal-footer-actions">
              <button
                type="button"
                className="action-btn"
                onClick={handleDownloadHtml}
                disabled={hasExportErrors}
                title={
                  hasExportErrors
                    ? "Fix selection errors before exporting"
                    : "Download as .html file"
                }
              >
                <i className="fa-solid fa-file-arrow-down" /> Download HTML
              </button>
              <button
                type="button"
                className="action-btn action-btn-export"
                onClick={handleOpenForPrint}
                disabled={hasExportErrors}
                title={
                  hasExportErrors
                    ? "Fix selection errors before exporting"
                    : "Open in a new tab — use Ctrl+P / ⌘+P to save as PDF"
                }
              >
                <i className="fa-solid fa-print" /> Open for Print / PDF
              </button>
            </div>
          </>
        )}
        {tab === "cuesheet" && !cuesheetReady && <span />}
      </div>
    </dialog>
  );
}
