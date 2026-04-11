import { useEffect, useRef } from "react";

interface LegendModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LegendModal({ open, onClose }: LegendModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="legend-modal" onClose={onClose}>
      <div className="legend-header">
        <h2>Guide</h2>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="legend-body">
        {/* ── Tips ── */}
        <h3 className="legend-subheading" style={{ marginTop: 0 }}>
          Tips
        </h3>

        <Section title="Upload Simple GPX Files">
          <p>
            Processing a large course can take a long time depending on your
            device. Prefer simple GPX files — e.g. a planned route export from{" "}
            <strong>RideWithGPS</strong> or <strong>Komoot</strong> — over
            activity files recorded on a device. Activity files can contain tens
            of thousands of noisy track points that slow parsing and inflate
            elevation figures.
          </p>
        </Section>

        <Section title="Export Your Course For Later">
          <p>
            Use the <strong>Export</strong> button to save your full course
            configuration as a JSON file. Run multiple different scenarios and
            store each one for future reference. Loading an export with{" "}
            <strong>Import</strong> restores the form instantly — and if the
            matching GPX is still stored in this browser, it is restored
            automatically too.
          </p>
        </Section>

        <Section title="Auto-Save & Refresh Safety">
          <p>
            Your form state is saved to <strong>localStorage</strong> on every
            change. Your GPX file is persisted to <strong>IndexedDB</strong>{" "}
            (the browser's local file store) on upload, so it survives a page
            refresh without re-uploading. Both are restored automatically when
            the page loads.
          </p>
        </Section>

        {/* ── Features ── */}
        <h3 className="legend-subheading">Features</h3>

        <Section title="Import">
          <p>
            Upload a previously exported JSON file to restore a course
            configuration. If the JSON references a GPX file that is still
            stored in this browser's IndexedDB (keyed by filename), that file is
            also restored automatically — no re-upload needed.
          </p>
        </Section>

        <Section title="Load GPX — where the magic comes together">
          <p>Loading a GPX file unlocks several features:</p>
          <ul>
            <li>
              <strong>Elevation analysis</strong> — per-split gain, loss, grade,
              steep-grade %, and dominant surface type, computed with
              Ramer–Douglas–Peucker simplification + sliding-window smoothing to
              filter GPS noise.
            </li>
            <li>
              <strong>Automatic timezone detection</strong> — each split's
              endpoint is matched against a compact boundary dataset entirely in
              the browser; no API call required. When a split's endpoint falls
              in a timezone different from the course timezone, a{" "}
              <span style={{ color: "#c4b5fd" }}>purple timezone badge</span>{" "}
              (🕐) is added automatically. If you change the split's distance so
              its endpoint moves to a new timezone, the badge updates to reflect
              the new location.
            </li>
            <li>
              <strong>Manual timezone override</strong> — you can choose a
              different timezone for any split via the <em>Split Timezone</em>{" "}
              selector in the Overrides panel. Once set manually, the badge
              turns <span style={{ color: "#fbbf24" }}>amber</span> and shows a
              ✏️ icon to signal that auto-detection is paused for that split.
              Selecting the course timezone from the picker clears the manual
              override and re-enables auto-detection.
            </li>
            <li>
              <strong>Nearby rest stop search</strong> — find fuel stations,
              convenience stores, pharmacies, cafés, and restaurants within 1 km
              of each split endpoint via the OpenStreetMap Overpass API. Results
              can be imported directly into the rest stop form including parsed
              open hours.
            </li>
            <li>
              <strong>Nearest city labels</strong> — each split distance field
              shows the nearest city, resolved in the background via Nominatim.
            </li>
            <li>
              <strong>GPX split export</strong> — download a trimmed GPX for any
              individual split directly from the Results section. Exported files
              contain course points only; extra data from the original is not
              preserved.
            </li>
            <li>
              <strong>Distance validation</strong> — splits are checked against
              the GPX total and flagged with asterisks (see Information below).
            </li>
          </ul>
        </Section>

        <Section title="Rest Stop Open Hours">
          <p>
            Each split can have a rest stop with per-day open hours (or a single
            schedule for every day). The calculator predicts your arrival time
            in the stop's local timezone and badges the result as{" "}
            <span style={{ color: "#4ade80" }}>🟢 Open</span>,{" "}
            <span style={{ color: "#facc15" }}>🟡 Near</span> (within 30 min of
            opening or closing), or{" "}
            <span style={{ color: "#f87171" }}>🔴 Closed</span>. Hours can be
            imported directly from a nearby stop search result.
          </p>
        </Section>

        <Section title="Auto-Calculation">
          <p>
            Results update automatically within 250 ms of you stopping typing —
            there is no Calculate button. Calculation only runs when all
            required fields are valid.
          </p>
        </Section>

        <Section title="Color-Coded Segments & Course Map">
          <p>
            Each segment is assigned a color that appears on the collapse toggle
            icon, the course map track, and the distance/elevation badges in the
            segment header. Portions of the course not yet covered by any split
            are shown in a light gray on the map.
          </p>
          <ul>
            <li>
              The <strong>course map legend</strong> is clickable — each legend
              entry zooms the map to that segment's portion of the track.
            </li>
            <li>
              Rest stop markers appear in{" "}
              <span style={{ color: "#a855f7" }}>purple (#a855f7)</span>. Use
              the map to quickly see which split endpoints don't have a rest
              stop configured, and to get a broader view of nearby cities beyond
              what the split form shows.
            </li>
            <li>
              Clicking a split endpoint marker on the map opens a popup with the
              split name and distance. Click <strong>↓ Go to split</strong> in
              the popup to jump directly to that split's form.
            </li>
          </ul>
        </Section>

        <Section title="Auto-Name from City Labels">
          <p>
            Once city labels have loaded for all splits, you can automatically
            update segment and split names to describe their start and end
            cities — useful for quickly labeling a course after routing.
          </p>
        </Section>

        {/* ── Disclaimers ── */}
        <h3 className="legend-subheading">Disclaimers</h3>

        <Section title="Data Accuracy">
          <p>
            Rest stop data, addresses, and open hours are supplied by{" "}
            <strong>OpenStreetMap</strong> volunteers. Accuracy varies —{" "}
            <strong>verify addresses and hours independently</strong> before
            relying on them for race or event planning.
          </p>
        </Section>

        <Section title="Address Resolution">
          <p>
            The integrated nearby-stop search attempts to fix missing or broken
            addresses using reverse geocoding. When a clean address cannot be
            resolved, the raw coordinates are displayed instead.
          </p>
          <p>
            Overpass API queries automatically cascade through several public
            mirrors if the primary endpoint is slow or unresponsive, improving
            reliability without any manual action.
          </p>
        </Section>

        {/* ── Information ── */}
        <h3 className="legend-subheading">Information</h3>

        <Section title="GPX Distance Indicators">
          <p>
            When a GPX file is loaded, the calculator knows the total course
            distance and checks your split configuration against it:
          </p>
          <ul>
            <li>
              <span style={{ color: "#f87171" }}>
                <strong>Red *</strong>
              </span>{" "}
              on a segment header or split — the cumulative distance at that
              point <em>exceeds</em> the GPX course distance.
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
            , requests are limited to <strong>1 per second</strong> — so labels
            load sequentially with a short delay between each one. Results are
            cached for the session; cached coordinates resolve instantly.
            Changing a split distance by more than 5 miles re-fetches the label
            for that split.
          </p>
          <p>
            The <strong>segment header</strong> shows{" "}
            <em>Starting City — Endpoint City</em> spanning the whole segment.
            Each <strong>split header</strong> shows the endpoint city for that
            split.
          </p>
        </Section>

        <Section title="Split & Segment Header Stats">
          <p>
            When a GPX file is loaded, each segment and split header displays
            several computed statistics:
          </p>
          <ul>
            <li>
              <span style={{ color: "#60a5fa" }}>Blue</span> — distance covered
              by the segment or split.
            </li>
            <li>
              <span style={{ color: "#4ade80" }}>Green</span> — elevation gain.
            </li>
            <li>
              <span style={{ color: "#f87171" }}>Red</span> — elevation loss.
            </li>
            <li>
              <span style={{ color: "#94a3b8" }}>Gray</span> — average grade.
            </li>
            <li>
              <span style={{ color: "#fbbf24" }}>Yellow</span> — steepness: the
              percentage of the distance where grade exceeds 5%.
            </li>
            <li>
              A <span style={{ color: "#c4b5fd" }}>purple timezone badge</span>{" "}
              (🕐) appears on a split when its endpoint is in a different
              timezone than the course-level timezone — set automatically from
              the GPX. When you manually override the timezone, the badge turns{" "}
              <span style={{ color: "#fbbf24" }}>amber</span> with a ✏️ icon.
              Unique timezone abbreviations are also summarized in the segment
              header.
            </li>
          </ul>
        </Section>

        {/* ── Key Terms ── */}
        <h3 className="legend-subheading">Key Terms</h3>

        <p className="legend-intro">
          <strong>Hierarchy:</strong> Course → Segment → Split → Sub-Split
        </p>

        <Section title="Mode">
          <p>Controls how split distance fields are interpreted.</p>
          <ul>
            <li>
              <strong>Distance</strong> — each value is the <em>length</em> of
              that split; values add up to the segment total.
            </li>
            <li>
              <strong>Target Distance</strong> — each value is a cumulative
              course marker from the start (mile/km); split lengths are derived
              from the difference between consecutive markers.
            </li>
          </ul>
        </Section>

        <Section title="Speed">
          <p>
            The starting moving speed used for pacing predictions. Each split's
            speed begins here and adjusts per the <em>Speed Delta</em> value.
          </p>
          <ul>
            <li>
              Can be <strong>overridden at the segment level</strong> to set a
              different starting speed for that segment.
            </li>
            <li>
              A segment-level override may be lower than the course-level Min
              Speed only if a lower Min Speed is also set on that segment.
            </li>
          </ul>
        </Section>

        <Section title="Min Speed">
          <p>
            The floor for moving speed at any point in the course. Speed Delta
            will never reduce speed below this value.
          </p>
          <ul>
            <li>
              Can be <strong>overridden at the segment level</strong> — useful
              for hilly or technical segments where a lower floor is realistic.
            </li>
          </ul>
        </Section>

        <Section title="Down Time Ratio">
          <p>
            Idle time expressed as a fraction of moving time (0–1). Accounts for
            traffic lights, crossings, brief stops, etc.
          </p>
          <ul>
            <li>Example: 1 h moving time × 0.1 DTR = 6 min of down time.</li>
            <li>
              Overridable at the <strong>segment level</strong>. At the{" "}
              <strong>split level</strong>, you can set a concrete number of
              minutes instead.
            </li>
          </ul>
        </Section>

        <Section title="Speed Delta">
          <p>
            A flat amount added to the rolling moving speed at each successive
            split. Positive values accelerate; negative values decelerate.
          </p>
          <ul>
            <li>
              Example: Speed 16 with delta −0.1 → 16.0 → 15.9 → 15.8 → … down to
              Min Speed.
            </li>
          </ul>
        </Section>

        <Section title="Segment">
          <p>
            Think of a segment as <em>distance ridden before sleeping</em>. A
            segment contains one or more splits and has its own totals for
            moving, active, and elapsed time.
          </p>
        </Section>

        <Section title="Split">
          <p>
            Think of a split as <em>distance ridden before a rest stop</em> (or
            a logical waypoint). Each split can optionally define a rest stop,
            adjustment time, and speed or down-time overrides.
          </p>
        </Section>

        <Section title="Sub-Split">
          <p>
            A finer-grained view of pacing within a split. The only configurable
            aspect is the interval mode:
          </p>
          <ul>
            <li>
              <strong>Even</strong> — divide the split into <em>N</em> equal
              sub-splits.
            </li>
            <li>
              <strong>Fixed</strong> — generate sub-splits of a given distance;
              the last sub-split is merged if it would be shorter than the
              threshold.
            </li>
            <li>
              <strong>Custom</strong> — provide a comma-separated list of
              distances (no validation on totals, but it doesn't affect other
              calculations).
            </li>
          </ul>
        </Section>

        <Section title="Sleep Time">
          <p>
            A concrete duration of sleep appended after a segment. Offsets the
            overall course timeline.
          </p>
        </Section>

        <Section title="Adjustment Time">
          <p>
            A concrete number of minutes added to a split — e.g. a planned
            restaurant stop. <strong>Can be negative</strong> to represent time
            saved.
          </p>
        </Section>

        <Section title="Include Down Time on Last Split">
          <p>
            Whether the final split in a segment should include down time. Turn
            off if the last split ends at your destination or rest point where
            extra buffer isn't needed.
          </p>
        </Section>

        <h3 className="legend-subheading">Time Definitions</h3>

        <Section title="Segment Times">
          <ul>
            <li>
              <strong>Moving Time</strong> — total time spent in motion.
            </li>
            <li>
              <strong>Active Time</strong> — moving time + down time (start to
              finish, excluding sleep).
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
              <strong>Active Time</strong> — split time + adjustment time.
            </li>
          </ul>
        </Section>

        <Section title="Sub-Split Times">
          <p>
            Same as split times. Note that <em>active time = split time</em>{" "}
            because adjustment time is not applied at the sub-split level.
          </p>
        </Section>
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
  return (
    <div className="legend-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
