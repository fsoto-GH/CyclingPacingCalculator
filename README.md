# 🚴‍♂️ CyclingPacingCalculator

## 🧠 Why I Built This

Multi-day ultra-endurance cycling events don't have a simple finish time. Your speed decays as fatigue accumulates. Sleep windows eat into your clock. Rest stops, aid stations, and segments with different terrain all compound into a final elapsed time that is nearly impossible to estimate in your head.

Before Mishigami 2025—a 1,121-mile race across Michigan—I needed a way to model different pacing strategies and understand the tradeoffs. How fast could I afford to start? How much would a 3-hour sleep window cost me versus a 1-hour nap? What happens if my average speed drops by 1 mph in the final 200 miles?

I built this calculator to answer those questions. It powered my race plan for Mishigami, where I finished 2nd place—the first Chicagoan ever to complete the race in under 4 days.

While the race is over, I continue to enhance this project. Since the race, the calculator has gained:

- GPX route loading with per-split elevation analysis (gain, loss, grade, surface, steep %)
- An embedded OSM map pin at each split endpoint
- Nearby rest stop search powered by the OpenStreetMap Overpass API
- Automatic timezone detection from GPX coordinates
- A natural language course summary with open-hours colour coding
- Real-time auto-calculation as you type (no Calculate button)
- Named courses, segments, and splits

Potential future directions:

- Interactive GPX route map (Leaflet.js) with full track visualization and multiple pins
- Google / HERE Places API integration for richer rest stop data
- Elevation profile chart per split
- Shareable plan URLs (encode form state in URL hash)

This repository contains:

- **A React + Vite frontend** — a full-featured web UI for the calculator, runs entirely in the browser (no server required for normal use).
- **A Dockerized FastAPI backend** — serves the frontend in production and exposes the calculator as an API.
- **A standalone Python package** — the raw pacing logic, usable without the API or UI.

---

## 🖥️ Frontend (React + Vite)

The frontend is a single-page React app located in [`frontend/`](./frontend). It runs the pacing calculator **entirely in the browser** — no API call is needed.

### Features

- Multi-segment, multi-split course builder
- Imperial / metric toggle
- Rest stop open hours with timezone-aware ETA badges
- Collapsible segments and splits
- Example courses (including the Mishigami Challenge)
- Import / export course definitions as JSON
- Results table with sub-split detail
- GPX route loading with per-split elevation analysis
- OSM-powered nearby stop search at each split endpoint
- Natural language course summary with open-hours status

### Run the frontend locally (dev mode)

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`. The Vite dev server proxies `/v1/...` requests to `http://localhost:8000` if you want to test against the API.

### Build the frontend (production)

```bash
cd frontend
npm install
npm run build
```

Output goes to `../static/`. The resulting files are a fully static site — host them on GitHub Pages, Netlify, Cloudflare Pages, S3, or anywhere that serves static files.

### Query parameters

| Parameter | Values            | Default  | Description                                                                           |
| --------- | ----------------- | -------- | ------------------------------------------------------------------------------------- |
| `engine`  | `client` \| `api` | `client` | `client` runs the calculator in-browser; `api` sends a request to the FastAPI backend |

Example: `http://localhost:5173/?engine=api`

When `engine=api` is active, the Calculate button label renders in gold to indicate the API path is being used.

---

## 📦 Using the Calculator as a Python Package

You don't need to run the API to use the pacing logic. The core functionality lives in the [`calculator` package](./pacing/calculator), which contains all pacing‑related computations. It works alongside the [`printer` package](./pacing/printer), which formats results into clean, human‑readable output.

To see how to use these packages directly, check out the [`examples/` directory](./pacing/examples). It includes runnable scripts demonstrating:

- How to compute pacing strategies
- How to print results using the printer utilities
- A rough draft of my Mishigami Challenge pacing plan

If you want to run the examples locally, install dependencies from the project root:

```bash
pip install -r requirements.txt
```

---

## 🚀 Running with Docker Compose

Docker Compose is the easiest way to run everything together. The Docker build:

1. Installs Node.js and builds the React frontend into `static/`
2. Installs Python dependencies
3. Starts the FastAPI server, which serves both the frontend (at `/`) and the API (at `/v1/...`)

### Start

```bash
docker compose up -d --build
```

Then open `http://localhost:8000`. That's it — the frontend and API are both served from the same container.

> **Note:** `--build` is required the first time, or any time you change **Python** code. For frontend changes, you must also rebuild the Docker image (via `--build`) since the React app is compiled into the image at build time — the volume mount in `docker-compose.yml` intentionally excludes `static/` to prevent a stale host build from overwriting the image-baked frontend.

### Updating the frontend while using Docker Compose

The `docker-compose.yml` mounts the project directory into the container for live Python reloading, but isolates the `static/` folder so Docker always serves the image-built frontend. This means:

| Scenario              | What to do                                                                   |
| --------------------- | ---------------------------------------------------------------------------- |
| Changed Python code   | `docker compose up -d` (no `--build`) — `--reload` picks it up automatically |
| Changed frontend code | `docker compose up -d --build` to rebuild the image                          |
| Frontend dev with HMR | Run `npm run dev` separately (proxies API to `localhost:8000`)               |

### Stop

```bash
docker compose down
```

### View logs

```bash
docker compose logs -f
```

---

## 🧱 Docker (without Compose)

### Build

```bash
docker build -t cycling/pacing-api:latest .
```

### Run

```bash
docker run -d -p 8000:8000 --name pacing-api cycling/pacing-api:latest
```

### Stop / Start

```bash
docker stop pacing-api
docker start pacing-api
```

---

## 🧭 API: Swagger UI

When the container is running, interactive API docs are available at:

```
http://localhost:8000/docs
```

---

## 📬 API: Calculator Endpoint

**POST** `http://localhost:8000/v1/cycling/calculator`

### Example request body

```json
{
  "segments": [
    {
      "splits": [
        {
          "distance": 40,
          "sub_split_mode": "fixed",
          "sub_split_distance": 20
        }
      ],
      "sleep_time": 3600
    }
  ],
  "mode": "distance",
  "init_moving_speed": 20,
  "min_moving_speed": 16.0,
  "down_time_ratio": 0.05,
  "split_decay": 0.25,
  "start_time": "2026-03-04T08:10:00"
}
```

See the Swagger UI at `/docs` for the full request/response schema.

---

## 🗺️ GPX Route Loading

You can load a `.gpx` file exported from Garmin, Komoot, RideWithGPS, Strava, or any standard GPS device. The file is parsed entirely in the browser — no server upload occurs.

### Parsing

The parser reads either `<trkpt>` (track) or `<rtept>` (route) elements, extracting latitude, longitude, and elevation. Cumulative distance is computed incrementally via the **Haversine formula** as each point is read, so no second pass is needed. A dominant surface tag is also extracted from `<extensions>` elements emitted by apps like Komoot and OsmAnd.

### Elevation computation

Raw GPS elevation data is notoriously noisy. A naïve cumulative-sum approach can produce wildly inflated gain/loss figures. The calculator uses a two-step algorithm that matches the output of [gpx.studio](https://gpx.studio):

1. **Ramer–Douglas–Peucker (RDP) simplification** is run on the `(cumulative distance, elevation)` 2D plane with a 20 m perpendicular-distance tolerance. This identifies *significant terrain anchors* — the peaks and valleys that represent genuine changes in slope — while discarding GPS jitter between them.

2. **100 m sliding-window smoothing** is then applied *between each pair of adjacent anchors*. A running sum maintains the window average in O(1) per step (the window start and end pointers advance monotonically), so the overall pass is O(n) rather than O(n·w). The raw GPS elevation is forced at each anchor endpoint to prevent drift.

3. Gain and loss are accumulated on the smoothed signal.

This produces results close to Garmin and Strava, and identical to gpx.studio for the same file.

### Per-split profiles

Once the full track is processed, it is *sliced* by split. Each split's start and end kilometre positions are resolved with **binary search** (O(log n)), avoiding a linear scan across potentially 30 000+ track points per split. The slice then receives its own elevation computation, average grade, percentage of distance with grade > 5 %, and a dominant surface tag.

In `target_distance` mode (where split distances are cumulative course markers rather than chunks), the profile computation normalises to chunk distances before slicing — mirroring the same normalisation done in the calculator engine.

The results are **debounced** (400 ms after the user stops editing distances) so that the expensive GPX slicing + timezone lookup doesn't fire on every keystroke.

### Per-split display

Each expanded split shows:

- ⬆ elevation gain / ⬇ elevation loss (converted to ft or m based on unit system)
- Average grade %
- Percentage of distance with grade > 5 % (marked 🟡 steep)
- Dominant surface (e.g. `asphalt`, `gravel`)
- An embedded OpenStreetMap iframe centred on the split endpoint with a pin

---

## 📍 OSM Nearby Stop Search

When a GPX is loaded, each split endpoint gains a **"Find Nearby Stops"** button. Clicking it opens a panel that immediately queries the [Overpass API](https://overpass-api.de) (OpenStreetMap's read API, no key required) for amenities within 1 km of the split's endpoint coordinates.

### Query design

The query is kept deliberately lean:

- **Nodes only** — `way` elements are skipped. The overwhelming majority of gas stations, convenience stores, pharmacies, and cafés are mapped as OSM nodes, so the query covers nearly all useful results at a fraction of the server cost.
- **1 km radius** — balances coverage against response size (area scales with r²).
- **`[timeout:10][maxsize:1048576]`** — the server aborts rather than streaming an oversized payload.
- **Amenity filter**: `fuel`, `supermarket`, `convenience`, `pharmacy`, `fast_food`, `cafe`, `restaurant`.

### Results display

Results are sorted by distance (ascending), with stops that have known hours ranked above those without. Each item shows:

- Icon + name
- Distance from the split endpoint in the course's unit system (mi/ft or km/m)
- Amenity type and address (built from OSM `addr:*` tags)
- Raw `opening_hours` string from OSM
- Coordinates (lat, lon to 5 decimal places ≈ 1 m resolution)

### Hours parsing

OSM `opening_hours` strings are parsed with a lightweight built-in parser that handles the most common patterns (`24/7`, `Mo-Fr 08:00-20:00; Sa-Su 09:00-18:00`, `off`, etc.) without pulling in the 130 KB `opening_hours.js` library. Successfully parsed hours are imported directly into the split's rest stop schedule.

### Selecting a result

Clicking a result pre-fills the rest stop form: name, address, and parsed open hours (if available) are applied. The split's open-hours ETA badge then immediately reflects the imported schedule.

### Future improvement

The Overpass API is a community dataset and coverage varies by region. A potential upgrade would integrate the **Google Places API** or **HERE Places API**, which offer richer commercial data (phone numbers, photos, real-time open/closed status) at the cost of an API key and per-request billing.

---

## 🌐 Timezone Handling

### Course timezone

Every course has a primary IANA timezone (e.g. `America/Chicago`). All start times, ETA calculations, and open-hours checks use this timezone as the default throughout.

### Per-split timezone override

Individual splits can be assigned a different IANA timezone via the *Different timezone?* checkbox. This is useful for routes that cross timezone boundaries mid-segment (common on long-distance events like Mishigami, which crosses entre Michigan).

When a GPX file is loaded, each split's endpoint timezone is **automatically detected** using the [tz-lookup](https://www.npmjs.com/package/tz-lookup) library, which performs a point-in-polygon lookup against a compact boundary dataset entirely in the browser — no geocoding API call required.

### Timezone-aware ETA badges

The results table checks each rest stop's open hours against the predicted arrival time in the *correct* timezone for that split. Badges show:

| Badge | Meaning |
|-------|---------|
| 🟢 Open | Arriving well within open hours (>30 min margin) |
| 🟡 Near | Arriving within 30 minutes of opening or closing |
| 🔴 Closed | Arriving outside open hours |

### Narrative timezone shifts

The natural language summary detects when a segment crosses a timezone boundary (e.g. CDT → ET) and appends a note inline: *(crosses time zones: CDT → ET)*. This uses `Intl.DateTimeFormat` to resolve the short abbreviation of each split's end time in the appropriate IANA zone.

---

## 🟢 Open Hours & Rest Stop Configuration

Each split can have a rest stop with per-day open hours. Hours can be set identically for every day or configured per day of the week (Mon–Sun). The mode options are:

- **Hours** — opens/closes at specific times
- **24h** — open around the clock
- **Closed** — always closed on that day

The ETA badge in results reflects which day of the week the calculator predicts you'll arrive, resolved in the split's effective timezone. This means a stop that is open Monday–Friday 08:00–20:00 will correctly show as closed if your pacing puts you there on a Saturday night.

---

## 📖 Natural Language Course Summary

After calculation, a prose summary is rendered above the detailed results table. It aims to give an at-a-glance read of the whole plan — useful for sharing or sanity-checking — rather than requiring the reader to interpret a table.

The summary is built from three layers of information:

1. **Course shape** — total distance, number of segments, start time and timezone.
2. **Per-segment narrative** — distance covered, rest stop names coloured by open/near/closed status, and a timezone-shift note when the segment crosses a boundary.
3. **Sleep bridges** — when segments are separated by sleep time, a sentence describes the rest duration and the time the next segment begins.
4. **Closing line** — predicted finish time and total elapsed time (coloured blue).

If a course name, segment name, or split name is provided in the form, the narrative uses those names rather than generic labels like "Segment 1".

---

## 🧩 Example Courses

The **Load Example** button (toolbar) opens a modal with pre-built course configurations. Loading an example completely replaces the current form state. The form auto-calculates immediately after loading.

### Included examples

| Example | Description |
|---------|-------------|
| **Simple Example** | A single 100-mile segment split into two halves, demonstrating sub-split modes (even and fixed) and a real rest stop at Specialized Chicago with per-day hours. |
| **Complex Example** | A multi-segment course with sleep time between segments, per-segment speed/decay overrides, and multiple timezones. |
| **Mishigami Challenge** | A two-segment, 1,121-mile plan modelled on the actual Mishigami ultra-endurance race across Michigan (Chicago → St Ignace → Chicago), with realistic pacing decay, sleep windows, and timezone crossings. |

Examples are defined as plain TypeScript objects in [`frontend/src/examples.ts`](./frontend/src/examples.ts). Adding a new example is as simple as adding an entry to the exported array — no build step or configuration change required.

