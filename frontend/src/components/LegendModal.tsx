import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ── Search infrastructure ──────────────────────────────────────────────────
interface SearchResult {
  openCats: Set<string>;
  openSecs: Set<string>; // "catKey:secTitle"
}

interface LegendCtx {
  searchResult: SearchResult | null;
  catKey: string;
  expandAllSignal: number;
  collapseAllSignal: number;
}

const LegendSearchContext = createContext<LegendCtx>({
  searchResult: null,
  catKey: "",
  expandAllSignal: 0,
  collapseAllSignal: 0,
});

type SearchEntry = { catKey: string; secTitle: string; keywords: string };

const SEARCH_INDEX: SearchEntry[] = [
  // Tips
  {
    catKey: "tips",
    secTitle: "Upload Simple GPX Files",
    keywords:
      "ridewithgps komoot activity noisy track points elevation device large slow",
  },
  {
    catKey: "tips",
    secTitle: "Export Your Course For Later",
    keywords:
      "export json configuration import restore reference backup save scenario",
  },
  {
    catKey: "tips",
    secTitle: "Auto-Save & Refresh Safety",
    keywords:
      "autosave localstorage indexeddb refresh persist restore automatic browser",
  },
  {
    catKey: "tips",
    secTitle: "Share a Course via URL",
    keywords: "share url example link param shareable load auto",
  },
  // Features
  {
    catKey: "features",
    secTitle: "Import",
    keywords: "import json restore configuration indexeddb filename autoload",
  },
  {
    catKey: "features",
    secTitle: "Load GPX — where the magic comes together",
    keywords:
      "gpx elevation gain loss grade steep surface timezone detection nominatim overpass rest stop export distance validation ramer smoothing",
  },
  {
    catKey: "features",
    secTitle: "Elevation Profile",
    keywords:
      "elevation profile chart zoom segment color reset full course split click legend",
  },
  {
    catKey: "features",
    secTitle: "Rest Stop Open Hours",
    keywords:
      "rest stop open closed near arrival hours schedule day timezone badge green yellow red 30 minutes",
  },
  {
    catKey: "features",
    secTitle: "Auto-Calculation",
    keywords:
      "auto calculate automatic update typing delay 250ms button trigger",
  },
  {
    catKey: "features",
    secTitle: "Color-Coded Segments & Course Map",
    keywords:
      "color segment map track legend marker rest stop popup city zoom navigate gray elevation toggle",
  },
  {
    catKey: "features",
    secTitle: "Auto-Name from City Labels",
    keywords:
      "auto name city label segment split prefix template placeholder rename from_city to_city from_state to_state segment_num split_num",
  },
  {
    catKey: "features",
    secTitle: "Examples",
    keywords: "example load preset mishigami trans am url share param",
  },
  {
    catKey: "features",
    secTitle: "Quick Setup",
    keywords: "quick setup segments splits distance sleep uniform build append",
  },
  {
    catKey: "features",
    secTitle: "Segment Pagination",
    keywords: "pagination page segments per page navigate large course",
  },
  // Disclaimers
  {
    catKey: "disclaimers",
    secTitle: "Data Accuracy",
    keywords:
      "accuracy openstreetmap volunteer data address hours verify planning race event",
  },
  {
    catKey: "disclaimers",
    secTitle: "Address Resolution",
    keywords:
      "address resolution geocoding coordinates overpass mirror fallback broken",
  },
  {
    catKey: "disclaimers",
    secTitle: "Browser & Device Support",
    keywords:
      "browser device support screen size mobile responsive 390 600 px minimum width",
  },
  // Information
  {
    catKey: "information",
    secTitle: "GPX Distance Indicators",
    keywords:
      "gpx distance indicator red yellow asterisk segment over under short exceeds",
  },
  {
    catKey: "information",
    secTitle: "Nearest Cities",
    keywords:
      "city nominatim api reverse geocoding distance rate limit cache label nearest 1 second",
  },
  {
    catKey: "information",
    secTitle: "Split & Segment Header Stats",
    keywords:
      "header stats blue green red gray yellow elevation grade steep timezone badge",
  },
  {
    catKey: "information",
    secTitle: "Start Time & Timezone",
    keywords:
      "start time timezone wall clock tz hint interpreted local course detected reset auto",
  },
  // Key Terms
  {
    catKey: "terms",
    secTitle: "Mode",
    keywords: "mode distance target cumulative marker",
  },
  {
    catKey: "terms",
    secTitle: "Speed",
    keywords: "speed moving pacing starting prediction mph kph",
  },
  {
    catKey: "terms",
    secTitle: "Min Speed",
    keywords: "min minimum speed floor limit lower bound",
  },
  {
    catKey: "terms",
    secTitle: "Down Time Ratio",
    keywords: "dtr down time ratio idle traffic crossings lights fraction",
  },
  {
    catKey: "terms",
    secTitle: "Speed Delta",
    keywords:
      "delta speed change decrease increase accelerate decelerate rolling",
  },
  {
    catKey: "terms",
    secTitle: "Segment",
    keywords: "segment day sleeping distance totals moving active elapsed",
  },
  {
    catKey: "terms",
    secTitle: "Split",
    keywords: "split waypoint rest stop adjustment override pacing",
  },
  {
    catKey: "terms",
    secTitle: "Sub-Split",
    keywords: "sub split interval even fixed custom distance finer",
  },
  {
    catKey: "terms",
    secTitle: "Sleep Time",
    keywords: "sleep time segment hours duration overnight rest",
  },
  {
    catKey: "terms",
    secTitle: "Adjustment Time",
    keywords:
      "adjustment time minutes negative split restaurant planned buffer",
  },
  {
    catKey: "terms",
    secTitle: "Down Time on Last",
    keywords: "down time last split end destination buffer include",
  },
  // Time Definitions
  {
    catKey: "time",
    secTitle: "Segment Times",
    keywords: "segment time moving active elapsed sleep total",
  },
  {
    catKey: "time",
    secTitle: "Split Times",
    keywords: "split moving time active down adjustment",
  },
  {
    catKey: "time",
    secTitle: "Sub-Split Times",
    keywords: "sub split time active equal adjustment",
  },
];

// ── Component ──────────────────────────────────────────────────────────────
interface LegendModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LegendModal({ open, onClose }: LegendModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const handleClose = () => {
    setSearchQuery("");
    onClose();
  };

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      requestAnimationFrame(() => searchRef.current?.focus());
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const searchResult = useMemo<SearchResult | null>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const openCats = new Set<string>();
    const openSecs = new Set<string>();
    for (const entry of SEARCH_INDEX) {
      const fullText =
        `${entry.catKey} ${entry.secTitle} ${entry.keywords}`.toLowerCase();
      if (fullText.includes(q)) {
        openCats.add(entry.catKey);
        openSecs.add(`${entry.catKey}:${entry.secTitle}`);
      }
    }
    return { openCats, openSecs };
  }, [searchQuery]);

  const noResults = searchResult !== null && searchResult.openCats.size === 0;
  const [expandAllSignal, setExpandAllSignal] = useState(0);
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);

  return (
    <dialog ref={dialogRef} className="legend-modal" onClose={handleClose}>
      <div className="legend-header">
        <div className="legend-header-left">
          <h2>Guide</h2>
          {!searchQuery && (
            <div className="legend-guide-expand-btns">
              <button
                type="button"
                className="legend-guide-btn"
                onClick={() => setExpandAllSignal((s) => s + 1)}
                title="Expand all sections"
              >
                ▼ Expand
              </button>
              <button
                type="button"
                className="legend-guide-btn"
                onClick={() => setCollapseAllSignal((s) => s + 1)}
                title="Collapse all sections"
              >
                ▶ Collapse
              </button>
            </div>
          )}
        </div>
        <div className="legend-header-right">
          <div className="legend-search-wrap">
            <input
              ref={searchRef}
              type="search"
              className="legend-search-input"
              placeholder="Search guide…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search guide"
            />
          </div>
          <button
            className="legend-close"
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="legend-body">
        <LegendSearchContext.Provider
          value={{
            searchResult,
            catKey: "",
            expandAllSignal,
            collapseAllSignal,
          }}
        >
          {noResults ? (
            <p className="legend-no-results">
              No results for &ldquo;<strong>{searchQuery.trim()}</strong>&rdquo;
            </p>
          ) : (
            <>
              {/* ── Tips ── */}
              <Category title="💡 Tips" catKey="tips">
                <Section title="Upload Simple GPX Files">
                  <p>
                    Processing a large course can take a long time depending on
                    your device. Prefer simple GPX files — e.g. a planned route
                    export from <strong>RideWithGPS</strong> or{" "}
                    <strong>Komoot</strong> — over activity files recorded on a
                    device. Activity files can contain tens of thousands of
                    noisy track points that slow parsing and inflate elevation
                    figures.
                  </p>
                </Section>

                <Section title="Export Your Course For Later">
                  <p>
                    Use the <strong>Export</strong> button to save your full
                    course configuration as a JSON file. Run multiple different
                    scenarios and store each one for future reference. Loading
                    an export with <strong>Import</strong> restores the form
                    instantly — and if the matching GPX is still stored in this
                    browser, it is restored automatically too.
                  </p>
                </Section>

                <Section title="Auto-Save & Refresh Safety">
                  <p>
                    Your form state is saved to <strong>localStorage</strong> on
                    every change. Your GPX file is persisted to{" "}
                    <strong>IndexedDB</strong> (the browser's local file store)
                    on upload, so it survives a page refresh without
                    re-uploading. Both are restored automatically when the page
                    loads.
                  </p>
                </Section>

                <Section title="Share a Course via URL">
                  <p>
                    Example courses loaded from the <strong>Examples</strong>{" "}
                    panel set a <code>?example=</code> query parameter in the
                    URL. You can copy and share that URL — anyone who opens it
                    will automatically load the same example. If they already
                    have unsaved data the app will prompt before overwriting it.
                  </p>
                </Section>
              </Category>

              {/* ── Features ── */}
              <Category title="✨ Features" catKey="features">
                <Section title="Import">
                  <p>
                    Upload a previously exported JSON file to restore a course
                    configuration. If the JSON references a GPX file that is
                    still stored in this browser's IndexedDB (keyed by
                    filename), that file is also restored automatically — no
                    re-upload needed.
                  </p>
                </Section>

                <Section title="Load GPX — where the magic comes together">
                  <p>Loading a GPX file unlocks several features:</p>
                  <ul>
                    <li>
                      <strong>Elevation analysis</strong> — per-split gain,
                      loss, grade, steep-grade %, and dominant surface type,
                      computed with Ramer–Douglas–Peucker simplification +
                      sliding-window smoothing to filter GPS noise.
                    </li>
                    <li>
                      <strong>Automatic timezone detection</strong> — each
                      split's endpoint is matched against a compact boundary
                      dataset entirely in the browser; no API call required.
                      When a split's endpoint falls in a timezone different from
                      the course timezone, a{" "}
                      <span style={{ color: "#c4b5fd" }}>
                        purple timezone badge
                      </span>{" "}
                      (🕐) is added automatically. If you change the split's
                      distance so its endpoint moves to a new timezone, the
                      badge updates to reflect the new location.
                    </li>
                    <li>
                      <strong>Manual timezone override</strong> — you can choose
                      a different timezone for any split via the{" "}
                      <em>Split Timezone</em> selector in the Overrides panel.
                      Once set manually, the badge turns{" "}
                      <span style={{ color: "#fbbf24" }}>amber</span> and shows
                      a ✏️ icon to signal that auto-detection is paused for that
                      split. Selecting the course timezone from the picker
                      clears the manual override and re-enables auto-detection.
                    </li>
                    <li>
                      <strong>Nearby rest stop search</strong> — find fuel
                      stations, convenience stores, pharmacies, cafés, and
                      restaurants within 1 km of each split endpoint via the
                      OpenStreetMap Overpass API. Results can be imported
                      directly into the rest stop form including parsed open
                      hours.
                    </li>
                    <li>
                      <strong>Nearest city labels</strong> — each split distance
                      field shows the nearest city, resolved in the background
                      via Nominatim.
                    </li>
                    <li>
                      <strong>GPX split export</strong> — download a trimmed GPX
                      for any individual split directly from the Results
                      section. Exported files contain course points only; extra
                      data from the original is not preserved.
                    </li>
                    <li>
                      <strong>Distance validation</strong> — splits are checked
                      against the GPX total and flagged with asterisks (see
                      Information below).
                    </li>
                  </ul>
                </Section>

                <Section title="Rest Stop Open Hours">
                  <p>
                    Each split can have a rest stop with per-day open hours (or
                    a single schedule for every day). The calculator predicts
                    your arrival time in the stop's local timezone and badges
                    the result as{" "}
                    <span style={{ color: "#4ade80" }}>🟢 Open</span>,{" "}
                    <span style={{ color: "#facc15" }}>🟡 Near</span> (within 30
                    min of opening or closing), or{" "}
                    <span style={{ color: "#f87171" }}>🔴 Closed</span>. Hours
                    can be imported directly from a nearby stop search result.
                  </p>
                </Section>

                <Section title="Auto-Calculation">
                  <p>
                    Results update automatically within 250 ms of you stopping
                    typing — there is no Calculate button. Calculation only runs
                    when all required fields are valid.
                  </p>
                </Section>

                <Section title="Color-Coded Segments & Course Map">
                  <p>
                    Each segment is assigned a color that appears on the
                    collapse toggle icon, the course map track, the elevation
                    profile overlay, and the distance/elevation badges in the
                    segment header. Portions of the course not yet covered by
                    any split are shown in a light gray on the map.
                  </p>
                  <ul>
                    <li>
                      The <strong>course map legend</strong> is clickable — each
                      legend entry zooms the map to that segment's portion of
                      the track, and also zooms the elevation profile to that
                      segment's range. Clicking the same segment again resets
                      the elevation zoom.
                    </li>
                    <li>
                      Rest stop markers appear in{" "}
                      <span style={{ color: "#a855f7" }}>purple</span>. They are
                      hidden by default; use the <strong>Rest Stops</strong>{" "}
                      toggle button on the map to show them.
                    </li>
                    <li>
                      Clicking a split endpoint marker on the map opens a popup
                      with the split name and distance. Click{" "}
                      <strong>↓ Go to split</strong> in the popup to jump
                      directly to that split's form.
                    </li>
                  </ul>
                </Section>

                <Section title="Elevation Profile">
                  <p>
                    When a GPX file is loaded, a full-course elevation chart
                    appears below the map. The chart always shows the entire
                    course at once, with each segment's range highlighted in its
                    assigned color.
                  </p>
                  <ul>
                    <li>
                      <strong>Zooming</strong> — click any area of the chart to
                      zoom into that split's distance range. The chart title
                      updates to show what is currently in view (e.g.{" "}
                      <em>Elevation: Segment 1 › Split 2</em>). Click a segment
                      in the map legend to zoom the elevation profile to that
                      segment; click the same segment again to reset.
                    </li>
                    <li>
                      <strong>Reset</strong> — the <em>↺ Reset</em> button in
                      the elevation header returns the chart to the full-course
                      view.
                    </li>
                    <li>
                      Zooming in reveals finer GPS detail — the chart samples up
                      to 300 points from whatever range is in view, so a smaller
                      range means higher resolution.
                    </li>
                  </ul>
                </Section>

                <Section title="Examples">
                  <p>
                    The <strong>Examples</strong> button in the top toolbar
                    loads pre-built courses including their GPX routes. If you
                    have unsaved data, the app will ask before overwriting it.
                    Loading an example also sets a <code>?example=</code> URL
                    parameter so the link is shareable.
                  </p>
                </Section>

                <Section title="Quick Setup">
                  <p>
                    The <strong>⚡ Quick Setup</strong> button in the segments
                    toolbar opens a dialog to rapidly build uniform segments.
                    Choose the number of segments, splits per segment, distance
                    per split, and sleep time per segment, then either{" "}
                    <strong>Build Segments</strong> (replace all) or{" "}
                    <strong>Append Segments</strong> (add to the end).
                  </p>
                </Section>

                <Section title="Segment Pagination">
                  <p>
                    Large courses with many segments are paginated. Use the
                    pagination bar above the segments list to navigate pages and
                    set how many segments are shown per page (5, 10, or 20).
                    Clicking <strong>↓ Go to split</strong> on the map
                    automatically jumps to the correct page.
                  </p>
                </Section>

                <Section title="Auto-Name from City Labels">
                  <p>
                    Once city labels have loaded for all splits, the{" "}
                    <strong>🏷️ Auto-Name</strong> button appears in the segments
                    toolbar. It sets segment and split names to describe their
                    start and end cities. Optional prefix templates support the
                    following tokens:
                  </p>
                  <ul>
                    <li>
                      <code>{"{segment_num}"}</code> — segment number (1-based)
                    </li>
                    <li>
                      <code>{"{split_num}"}</code> — split number within the
                      segment (1-based)
                    </li>
                    <li>
                      <code>{"{from_city}"}</code> — name of the starting city
                    </li>
                    <li>
                      <code>{"{to_city}"}</code> — name of the ending city
                    </li>
                    <li>
                      <code>{"{from_state}"}</code> — state/region of the
                      starting city
                    </li>
                    <li>
                      <code>{"{to_state}"}</code> — state/region of the ending
                      city
                    </li>
                  </ul>
                  <p>
                    You can choose to append a <em>City A → City B</em> route
                    label, rename only unnamed items, or overwrite all existing
                    names.
                  </p>
                </Section>
              </Category>

              {/* ── Disclaimers ── */}
              <Category title="⚠️ Disclaimers" catKey="disclaimers">
                <Section title="Browser & Device Support">
                  <p>
                    This app requires a modern desktop or tablet browser.
                    Minimum supported viewport width is <strong>390 px</strong>{" "}
                    (iPhone 12/13/14 Pro portrait), but at that size some
                    features are constrained — maps, elevation charts, and
                    results tables are cramped.
                  </p>
                  <p>
                    <strong>600 px or wider is strongly recommended</strong> for
                    full access to all features. Anything narrower than 390 px
                    is not supported and will likely produce layout issues.
                  </p>
                  <p>
                    This app is not optimised for touch-only use. GPX file
                    uploads, drag-to-zoom map interactions, and multi-column
                    forms work best with a keyboard and pointer device.
                  </p>
                </Section>

                <Section title="Data Accuracy">
                  <p>
                    Rest stop data, addresses, and open hours are supplied by{" "}
                    <strong>OpenStreetMap</strong> volunteers. Accuracy varies —{" "}
                    <strong>verify addresses and hours independently</strong>{" "}
                    before relying on them for race or event planning.
                  </p>
                </Section>

                <Section title="Address Resolution">
                  <p>
                    The integrated nearby-stop search attempts to fix missing or
                    broken addresses using reverse geocoding. When a clean
                    address cannot be resolved, the raw coordinates are
                    displayed instead.
                  </p>
                  <p>
                    Overpass API queries automatically cascade through several
                    public mirrors if the primary endpoint is slow or
                    unresponsive, improving reliability without any manual
                    action.
                  </p>
                </Section>
              </Category>

              {/* ── Information ── */}
              <Category title="ℹ️ Information" catKey="information">
                <Section title="Start Time & Timezone">
                  <p>
                    The <strong>Start Time</strong> field uses your course
                    timezone, not the browser's local timezone. If the two
                    differ, a hint line appears below the field showing the
                    wall-clock interpretation — e.g.{" "}
                    <em>Interpreted as 6:00 AM PDT</em>.
                  </p>
                  <p>
                    When a GPX file is loaded the timezone is auto-detected from
                    the track's first point. A <strong>Reset to auto</strong>{" "}
                    button appears next to the Timezone field if the current
                    value differs from what was detected.
                  </p>
                </Section>

                <Section title="GPX Distance Indicators">
                  <p>
                    When a GPX file is loaded, the calculator knows the total
                    course distance and checks your split configuration against
                    it:
                  </p>
                  <ul>
                    <li>
                      <span style={{ color: "#f87171" }}>
                        <strong>Red *</strong>
                      </span>{" "}
                      on a segment header or split — the cumulative distance at
                      that point <em>exceeds</em> the GPX course distance.
                    </li>
                    <li>
                      <span style={{ color: "#facc15" }}>
                        <strong>Yellow *</strong>
                      </span>{" "}
                      on the final segment — the total configured distance falls{" "}
                      <em>short</em> of the GPX course distance.
                    </li>
                  </ul>
                </Section>

                <Section title="Nearest Cities">
                  <p>
                    City labels are fetched from the{" "}
                    <a
                      href="https://nominatim.org"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Nominatim reverse geocoding API
                    </a>{" "}
                    (OpenStreetMap). Out of respect for their{" "}
                    <a
                      href="https://operations.osmfoundation.org/policies/nominatim/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      usage policy
                    </a>
                    , requests are limited to <strong>1 per second</strong> — so
                    labels load sequentially with a short delay between each
                    one. Results are cached; cached coordinates resolve
                    instantly. Changing a split distance by more than 5 miles
                    re-fetches the label for that split.
                  </p>
                  <p>
                    The <strong>segment header</strong> shows{" "}
                    <em>Starting City — Endpoint City</em> spanning the whole
                    segment. Each <strong>split header</strong> shows the
                    endpoint city for that split.
                  </p>
                </Section>

                <Section title="Split & Segment Header Stats">
                  <p>
                    When a GPX file is loaded, each segment and split header
                    displays several computed statistics:
                  </p>
                  <ul>
                    <li>
                      <span style={{ color: "#60a5fa" }}>Blue</span> — distance
                      covered by the segment or split.
                    </li>
                    <li>
                      <span style={{ color: "#4ade80" }}>Green</span> —
                      elevation gain.
                    </li>
                    <li>
                      <span style={{ color: "#f87171" }}>Red</span> — elevation
                      loss.
                    </li>
                    <li>
                      <span style={{ color: "#94a3b8" }}>Gray</span> — average
                      grade.
                    </li>
                    <li>
                      <span style={{ color: "#fbbf24" }}>Yellow</span> —
                      steepness: the percentage of the distance where grade
                      exceeds 5%.
                    </li>
                    <li>
                      A{" "}
                      <span style={{ color: "#c4b5fd" }}>
                        purple timezone badge
                      </span>{" "}
                      (🕐) shows all timezone abbreviations encountered across
                      the segment's splits, in the order they first appear.
                      Adjacent identical abbreviations are collapsed. When you
                      manually override the timezone, the badge turns{" "}
                      <span style={{ color: "#fbbf24" }}>amber</span> with a ✏️
                      icon.
                    </li>
                  </ul>
                </Section>
              </Category>

              {/* ── Key Terms ── */}
              <Category title="📖 Key Terms" catKey="terms">
                <p className="legend-intro" style={{ margin: "0.5rem 0" }}>
                  <strong>Hierarchy:</strong> Course → Segment → Split →
                  Sub-Split
                </p>

                <Section title="Mode">
                  <p>Controls how split distance fields are interpreted.</p>
                  <ul>
                    <li>
                      <strong>Distance</strong> — each value is the{" "}
                      <em>length</em> of that split; values add up to the
                      segment total.
                    </li>
                    <li>
                      <strong>Target Distance</strong> — each value is a
                      cumulative course marker from the start (mile/km); split
                      lengths are derived from the difference between
                      consecutive markers.
                    </li>
                  </ul>
                </Section>

                <Section title="Speed">
                  <p>
                    The starting moving speed used for pacing predictions. Each
                    split's speed begins here and adjusts per the{" "}
                    <em>Speed Delta</em> value.
                  </p>
                  <ul>
                    <li>
                      Can be <strong>overridden at the segment level</strong> to
                      set a different starting speed for that segment.
                    </li>
                    <li>
                      A segment-level override may be lower than the
                      course-level Min Speed only if a lower Min Speed is also
                      set on that segment.
                    </li>
                  </ul>
                </Section>

                <Section title="Min Speed">
                  <p>
                    The floor for moving speed at any point in the course. Speed
                    Delta will never reduce speed below this value.
                  </p>
                  <ul>
                    <li>
                      Can be <strong>overridden at the segment level</strong> —
                      useful for hilly or technical segments where a lower floor
                      is realistic.
                    </li>
                  </ul>
                </Section>

                <Section title="Down Time Ratio">
                  <p>
                    Idle time expressed as a fraction of moving time (0–1).
                    Accounts for traffic lights, crossings, brief stops, etc.
                  </p>
                  <ul>
                    <li>
                      Example: 1 h moving time × 0.1 DTR = 6 min of down time.
                    </li>
                    <li>
                      Overridable at the <strong>segment level</strong>. At the{" "}
                      <strong>split level</strong>, you can set a concrete
                      number of minutes instead.
                    </li>
                  </ul>
                </Section>

                <Section title="Speed Delta">
                  <p>
                    A flat amount added to the rolling moving speed at each
                    successive split. Positive values accelerate; negative
                    values decelerate.
                  </p>
                  <ul>
                    <li>
                      Example: Speed 16 with delta −0.1 → 16.0 → 15.9 → 15.8 → …
                      down to Min Speed.
                    </li>
                  </ul>
                </Section>

                <Section title="Segment">
                  <p>
                    Think of a segment as{" "}
                    <em>distance ridden before sleeping</em>. A segment contains
                    one or more splits and has its own totals for moving,
                    active, and elapsed time.
                  </p>
                </Section>

                <Section title="Split">
                  <p>
                    Think of a split as{" "}
                    <em>distance ridden before a rest stop</em> (or a logical
                    waypoint). Each split can optionally define a rest stop,
                    adjustment time, and speed or down-time overrides.
                  </p>
                </Section>

                <Section title="Sub-Split">
                  <p>
                    A finer-grained view of pacing within a split. The only
                    configurable aspect is the interval mode:
                  </p>
                  <ul>
                    <li>
                      <strong>Even</strong> — divide the split into <em>N</em>{" "}
                      equal sub-splits.
                    </li>
                    <li>
                      <strong>Fixed</strong> — generate sub-splits of a given
                      distance; the last sub-split is merged if it would be
                      shorter than the threshold.
                    </li>
                    <li>
                      <strong>Custom</strong> — provide a comma-separated list
                      of distances (no validation on totals, but it doesn't
                      affect other calculations).
                    </li>
                  </ul>
                </Section>

                <Section title="Sleep Time">
                  <p>
                    A concrete duration of sleep appended after a segment.
                    Offsets the overall course timeline.
                  </p>
                </Section>

                <Section title="Adjustment Time">
                  <p>
                    A concrete number of minutes added to a split — e.g. a
                    planned restaurant stop. <strong>Can be negative</strong> to
                    represent time saved.
                  </p>
                </Section>

                <Section title="Down Time on Last">
                  <p>
                    Whether the final split in a segment should include down
                    time. Turn off if the last split ends at your destination or
                    rest point where extra buffer isn't needed.
                  </p>
                </Section>
              </Category>

              {/* ── Time Definitions ── */}
              <Category title="⏱ Time Definitions" catKey="time">
                <Section title="Segment Times">
                  <ul>
                    <li>
                      <strong>Moving Time</strong> — total time spent in motion.
                    </li>
                    <li>
                      <strong>Active Time</strong> — moving time + down time
                      (start to finish, excluding sleep).
                    </li>
                    <li>
                      <strong>Elapsed Time</strong> — active time + sleep time.
                    </li>
                  </ul>
                </Section>

                <Section title="Split Times">
                  <ul>
                    <li>
                      <strong>Moving Time</strong> — time spent in motion.
                    </li>
                    <li>
                      <strong>Split Time</strong> — moving time + down time.
                    </li>
                    <li>
                      <strong>Active Time</strong> — split time + adjustment
                      time.
                    </li>
                  </ul>
                </Section>

                <Section title="Sub-Split Times">
                  <p>
                    Same as split times. Note that{" "}
                    <em>active time = split time</em> because adjustment time is
                    not applied at the sub-split level.
                  </p>
                </Section>
              </Category>
            </>
          )}
        </LegendSearchContext.Provider>
      </div>
    </dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { searchResult, catKey, expandAllSignal, collapseAllSignal } =
    useContext(LegendSearchContext);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (expandAllSignal > 0 && !searchResult) setOpen(true);
  }, [expandAllSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (collapseAllSignal > 0 && !searchResult) setOpen(false);
  }, [collapseAllSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // When search is active, hide non-matching sections.
  if (searchResult && !searchResult.openSecs.has(`${catKey}:${title}`)) {
    return null;
  }

  // Auto-expand when a search is active; otherwise honour local state.
  const isOpen = searchResult ? true : open;

  return (
    <div className={`legend-section${isOpen ? " legend-section--open" : ""}`}>
      <button
        type="button"
        className="legend-section-toggle"
        onClick={() => {
          if (!searchResult) setOpen((v) => !v);
        }}
        aria-expanded={isOpen}
      >
        <span className="legend-section-chevron">{isOpen ? "▼" : "►"}</span>
        <span>{title}</span>
      </button>
      {isOpen && <div className="legend-section-body">{children}</div>}
    </div>
  );
}

function Category({
  title,
  catKey,
  children,
}: {
  title: string;
  catKey: string;
  children: React.ReactNode;
}) {
  const { searchResult, expandAllSignal, collapseAllSignal } =
    useContext(LegendSearchContext);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (expandAllSignal > 0 && !searchResult) setOpen(true);
  }, [expandAllSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (collapseAllSignal > 0 && !searchResult) setOpen(false);
  }, [collapseAllSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // When search is active, hide categories with no matching sections.
  if (searchResult && !searchResult.openCats.has(catKey)) return null;

  // Auto-expand when a search is active; otherwise honour local state.
  const isOpen = searchResult ? true : open;

  return (
    <LegendSearchContext.Provider
      value={{ searchResult, catKey, expandAllSignal, collapseAllSignal }}
    >
      <div className="legend-category">
        <button
          type="button"
          className="legend-category-toggle"
          onClick={() => {
            if (!searchResult) setOpen((v) => !v);
          }}
          aria-expanded={isOpen}
        >
          <span className="legend-category-chevron">{isOpen ? "▼" : "►"}</span>
          <span>{title}</span>
        </button>
        {isOpen && <div className="legend-category-body">{children}</div>}
      </div>
    </LegendSearchContext.Provider>
  );
}
