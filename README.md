# 🚴‍♂️ Ultra Cycling Planner

## 🧠 Why I Built This

Multi-day ultra-endurance cycling events don't have a simple finish time. Your speed decays as fatigue accumulates. Sleep windows eat into your clock. Rest stops, aid stations, and segments with different terrain all compound into a final elapsed time that is nearly impossible to estimate in your head.

Before Mishigami 2025—a 1,121-mile race across Michigan—I needed a way to model different pacing strategies and understand the tradeoffs. How fast could I afford to start? How much would a 3-hour sleep window cost me versus a 1-hour nap? What happens if my average speed drops by 1 mph in the final 200 miles?

I built this calculator to answer those questions. It powered my race plan for Mishigami, where I finished 2nd place—the first Chicagoan ever to complete the race in under 4 days.

This repository contains:

- **A React + Vite frontend** — a full-featured web UI for the calculator, runs entirely in the browser (no server required for normal use).
- **A Dockerized FastAPI backend** — serves the frontend in production and exposes the calculator as an API.
- **A standalone Python package** — the raw pacing logic, usable without the API or UI.

---

## 🖥️ Frontend (React + Vite)

The frontend is a single-page React app located in [`frontend/`](./frontend). It runs the pacing calculator **entirely in the browser** — no API call is needed.

### Core features (always available)

- Multi-segment, multi-split course builder with **Distance** and **Target Distance** modes
- Per-split sub-split breakdown: **Hour** (split at each elapsed hour), **Even** (divide into N chunks), **Fixed** (chunk at a set distance), **Custom** (explicit comma-separated distances)
- Imperial / metric unit toggle with in-place conversion of all inputs
- Speed decay (`Speed Δ`) and per-segment speed / decay overrides
- Down-time ratio to model non-moving time (snack stops, traffic lights, etc.)
- Sleep time per segment — contributes to elapsed time but not moving time
- Transit segments — fixed elapsed-time + distance for non-cycling travel (ferry, shuttle, train), shown with a ⏩ icon
- Rest stop open hours with per-day schedule (Hours / 24h / Closed), timezone-aware ETA badges (🟢 Open / 🟡 Near Close / 🔴 Closed)
- ETA margin settings — configurable time windows (minutes) for Near Open / Near Close badge thresholds
- **Planning** tab for editing; **Projections** tab for calculated results
- Real-time auto-calculation (no Calculate button needed)
- Validation status icon (green ✓ / orange !) in the course name header; click to view all errors
- Segment pagination — page through large courses at 5 / 10 / 20 segments per page
- Quick Setup dialog — build uniform segments (equal splits, same speed) in one dialog
- Insert Segment zones — hover-revealed zones between segments for one-click insertion
- Collapsible segments and splits; expand/collapse all buttons in the toolbar
- Named courses, segments, and splits with Auto-Name from resolved city labels
- Import / export course definitions as JSON
- Example courses (Mishigami Challenge, Trans Am Classic, and two simpler demos)
- Form state persisted to **localStorage**; GPX file persisted to **IndexedDB**

### GPX & route features

- GPX file upload — parsed entirely in the browser, no server upload
- **RideWithGPS** route loading — paste a route URL or ID to import directly from RWGPS (requires Docker backend)
- Per-split elevation analysis: gain / loss, average grade, % steep (> 5 %), dominant surface
- Full-course elevation profile chart with segment color overlays and interactive split zoom
- GPX split export — download a trimmed GPX for any individual split from the Projections tab
- OSM-powered nearby stop search at each split endpoint via the Overpass API (no API key)
- Nearby city labels on split inputs via Nominatim reverse geocoding
- Automatic timezone detection from GPS coordinates using tz-lookup (no API call)

### Map features

- Interactive Leaflet course map with color-coded segment polylines, split markers, and rest stop pins
- Five free tile layers always available: **Standard** (OSM), **Topographic** (OpenTopoMap), **CyclOSM**, **Carto Dark Matter**, **Carto Positron**
- Wind direction overlay on split endpoint and transit segment maps
- Split endpoint map — full-screen Leaflet map at each split with nearby stop search and marker placement
- Transit segment map — same map panel for transit legs
- Default map style preference — saved to user settings (localStorage or DB when signed in)

### Weather forecast

- **Fetch Forecast** button in the Projections toolbar loads hourly weather for every split endpoint using **Open-Meteo** (free, no API key required)
- Displays temperature (°C/°F), feels-like, precipitation probability, wind speed/direction/gusts, humidity, cloud cover, and a WMO weather icon for each split
- Requires a loaded GPX and a start time within the 16-day forecast window; button is hidden otherwise
- Results cached in sessionStorage per location; supports historical data (Open-Meteo archive) for past course dates

### Run the frontend locally (dev mode)

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`. The Vite dev server proxies `/v1/...` requests to `http://localhost:8000` if you want to test against the API.

### Browser persistence

The frontend uses two browser-local storage mechanisms — no server, no account required:

| Storage      | What is stored                   | Lifetime                              |
| ------------ | -------------------------------- | ------------------------------------- |
| localStorage | Full form state (JSON, compact)  | Until cleared manually or Reset       |
| IndexedDB    | Raw GPX file (keyed by filename) | Until Remove / Reset or browser clear |

Both are restored automatically on page load. If you export a course JSON and later import it on the same browser, the referenced GPX file (if still present in IndexedDB) is restored without re-uploading.

### Query parameters

| Parameter  | Values         | Default  | Description                                                                        |
| ---------- | -------------- | -------- | ---------------------------------------------------------------------------------- |
| ⚠️`engine` | `client`/`api` | `client` | `client` runs the calculator in-browser; `api` sends a POST to the FastAPI backend |

> **Note:** The TypeScript client calculator and Python API calculator may not be fully in parity. `client` mode is the actively developed path.

---

## 🔐 Server Functions (`VITE_ENABLE_SERVER_FUNCTIONS`)

This flag is set at **build time** in `.env` (or as a Docker build-arg). It controls whether server-dependent features are compiled into the app.

```dotenv
VITE_ENABLE_SERVER_FUNCTIONS=true   # enables server features
VITE_ENABLE_SERVER_FUNCTIONS=false  # default — fully serverless
```

### When `false` (default)

The app runs entirely in the browser. No account, no login, no external auth required. All core pacing, GPX, weather (if key provided), and map features work. Settings are saved to localStorage only.

### When `true` — additional features enabled

These features require the FastAPI backend (Docker) to be running:

#### Google Sign-In

- A **Sign In with Google** button appears in the nav bar (Supabase OAuth)
- Signing in syncs user settings to the database and restores them on any device

#### User Settings modal (⚙ gear icon in nav)

Only visible to signed-in users. Provides:

- **ETA Margins** — set the time windows (minutes) for Near Open / Near Close ETA badges. Persisted to your account.
- **Stop Search Criteria** — configure search radius and amenity type checkboxes for the Overpass nearby-stop search. Type selections persist; Google Places text search (when enabled) is session-only.
- **Default Map Style** — choose the starting tile layer for all map views. Google tile layers only appear here when your account has `enable_google_maps` set.

#### My Race Plans

- **Save as…** — save the current course as a named plan in the cloud
- **Open** (race plans icon in toolbar) — browse, rename, delete, and load your saved plans
- Plans can be shared by URL; public plans are visible to anyone with the link
- The course name header shows a **dirty indicator** (●) when unsaved changes exist

#### RideWithGPS route search

- A **Search** tab in the GPX import dialog lets you search your RWGPS routes and collections by name
- Requires a RideWithGPS OAuth connection (one-click connect button in the modal)
- Backend handles the OAuth flow; token stored in localStorage

#### Google Maps tile layers (per-user flag)

When your account has `enable_google_maps` enabled by an admin, four additional tile layers become available in all map views: **Google Maps**, **Google Satellite**, **Google Terrain**, **Google Dark**. These require a server-side session token fetched from the backend.

#### Google Places nearby-stop search (per-user flag)

When your account has `enable_google_places` enabled, a **Google Places text search** field appears in the Nearby Stops panel and in the Settings modal. This replaces the Overpass type-checkbox search with a free-text query (e.g. "Walmart, bike shop"). Session-only — not persisted.

---

## 🔑 Environment Variables

| Variable                       | Where used     | Required               | Description                                                                               |
| ------------------------------ | -------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `VITE_ENABLE_SERVER_FUNCTIONS` | Frontend build | No                     | Set `true` to enable auth, race plans, RWGPS search, Google maps/places                   |
| `VITE_API_BASE_URL`            | Frontend build | If split-origin deploy | Backend origin for `/v1/...` calls when frontend is hosted separately (e.g. GitHub Pages) |
| `VITE_SUPABASE_URL`            | Frontend build | If SF=true             | Supabase project URL for Google OAuth                                                     |
| `VITE_SUPABASE_ANON_KEY`       | Frontend build | If SF=true             | Supabase anon/public key                                                                  |
| `VITE_GOOGLE_CLIENT_ID`        | Frontend build | If SF=true             | Google OAuth client ID (also used for Sign-In button)                                     |
| `GOOGLE_CLIENT_ID`             | Backend        | If SF=true             | Same Google OAuth client ID (backend validation)                                          |
| `GOOGLE_CLIENT_SECRET`         | Backend        | If SF=true             | Google OAuth client secret                                                                |
| `GOOGLE_PLACES_API_KEY`        | Backend        | No                     | Enables Google Places nearby-stop search for flagged users                                |
| `RIDEWITHGPS_API_KEY`          | Backend        | No                     | Enables RideWithGPS route search and OAuth                                                |
| `RIDEWITHGPS_CLIENT_ID`        | Backend        | No                     | RideWithGPS OAuth client ID                                                               |
| `RIDEWITHGPS_CLIENT_SECRET`    | Backend        | No                     | RideWithGPS OAuth client secret                                                           |
| `SUPABASE_URL`                 | Backend        | If SF=true             | Supabase project URL (for token verification)                                             |
| `DATABASE_URL_LOCAL`           | Backend        | If IS_LOCAL            | PostgreSQL connection string for local DB                                                 |
| `DATABASE_URL_SUPABASE`        | Backend        | If !IS_LOCAL           | PostgreSQL connection string for Supabase DB                                              |
| `IS_LOCAL`                     | Backend        | No                     | `true` = use local Docker DB; `false` = use Supabase DB                                   |

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

> **Note:** `--build` is required the first time, or any time you change **Python** code or **frontend** code. The React app is compiled into the image at build time — the volume mount in `docker-compose.yml` intentionally excludes `static/` to prevent a stale host build from overwriting the image-baked frontend.

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
  "split_delta": -0.25,
  "start_time": "2026-03-04T08:10:00"
}
```

See the Swagger UI at `/docs` for the full request/response schema.

---

## � RideWithGPS Route Loading

With the Docker backend running, you can import routes directly from RideWithGPS without downloading a GPX file first:

1. Open the GPX import dialog and switch to the **Search** tab.
2. Connect your RWGPS account via the one-click OAuth flow (token stored in localStorage).
3. Browse routes and collections, or search by name.
4. Select a route — the backend fetches the track points and the frontend processes them identically to a GPX upload.

RWGPS routes include course points (cue sheet entries) and POIs, which appear as waypoints on the course map.

---

## �🗺️ GPX Route Loading

You can load a `.gpx` file exported from Garmin, Komoot, RideWithGPS, Strava, or any standard GPS device. The file is parsed entirely in the browser — no server upload occurs.

### Parsing

The parser reads either `<trkpt>` (track) or `<rtept>` (route) elements, extracting latitude, longitude, and elevation. Cumulative distance is computed incrementally via the **Haversine formula** as each point is read, so no second pass is needed. A dominant surface tag is also extracted from `<extensions>` elements emitted by apps like Komoot and OsmAnd.

### Elevation computation

Raw GPS elevation data is notoriously noisy. A naïve cumulative-sum approach can produce wildly inflated gain/loss figures. The calculator uses a two-step algorithm that matches the output of [gpx.studio](https://gpx.studio):

1. **Ramer-Douglas-Peucker (RDP) simplification** is run on the `(cumulative distance, elevation)` 2D plane with a 20 m perpendicular-distance tolerance. This identifies _significant terrain anchors_ — the peaks and valleys that represent genuine changes in slope — while discarding GPS jitter between them.

2. **100 m sliding-window smoothing** is then applied _between each pair of adjacent anchors_. A running sum maintains the window average in O(1) per step (the window start and end pointers advance monotonically), so the overall pass is O(n) rather than O(n·w). The raw GPS elevation is forced at each anchor endpoint to prevent drift.

3. Gain and loss are accumulated on the smoothed signal.

This produces results close to Garmin and Strava, and identical to gpx.studio for the same file.

### Per-split profiles

Once the full track is processed, it is _sliced_ by split. Each split's start and end kilometre positions are resolved with **binary search** (O(log n)), avoiding a linear scan across potentially 30 000+ track points per split. The slice then receives its own elevation computation, average grade, percentage of distance with grade > 5 %, and a dominant surface tag.

In `target_distance` mode (where split distances are cumulative course markers rather than chunks), the profile computation normalises to chunk distances before slicing — mirroring the same normalisation done in the calculator engine.

The results are **debounced** (400 ms after the user stops editing distances) so that the expensive GPX slicing + timezone lookup doesn't fire on every keystroke.

### Per-split display

Each expanded split shows:

- ⬆ elevation gain / ⬇ elevation loss (converted to ft or m based on unit system)
- Average grade %
- Percentage of distance with grade > 5 % (marked 🟡 steep)
- Dominant surface (e.g. `asphalt`, `gravel`)
- Nearest city label (fetched in the background via Nominatim with 1 req/s rate limiting)

### GPX split export

From the **Projections** tab, each segment has an **Export GPX splits** button that opens a modal listing all splits with their elevation statistics. You can select individual splits or the full segment and download a trimmed GPX. The exported file contains course waypoints only — any device-specific extensions or metadata from the original file are not preserved.

### GPX distance indicators

When a GPX file is loaded, the calculator checks your split configuration against the GPX total distance:

- **Red \*** on a segment header or split — cumulative distance at that point exceeds the GPX course distance.
- **Yellow \*** on the final segment — total configured distance falls short of the GPX course distance.

---

## 📍 OSM Nearby Stop Search

When a GPX is loaded, each split endpoint gains a **"Find Nearby Stops"** button. Clicking it opens a panel that immediately queries the [Overpass API](https://overpass-api.de) (OpenStreetMap's read API, no key required) for amenities within 1 km of the split's endpoint coordinates.

### Query design

The query is kept deliberately lean:

- **Nodes only** — `way` elements are skipped. The overwhelming majority of gas stations, convenience stores, pharmacies, and cafés are mapped as OSM nodes, so the query covers nearly all useful results at a fraction of the server cost.
- **Configurable radius** — default 1 km (0.5 mi); adjustable from 0.5 mi up to 25 mi in the Settings modal or Nearby Stops panel.
- **`[timeout:10][maxsize:1048576]`** — the server aborts rather than streaming an oversized payload.
- **Default amenity types**: `fuel`, `supermarket`, `convenience`, `pharmacy`, `fast_food`, `cafe`, `restaurant`. Configurable in Settings.

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

---

## ☁️ Weather Forecast

The **Forecast** button in the Projections toolbar fetches hourly weather data for each split endpoint using the [Open-Meteo API](https://open-meteo.com) — a free, open-source weather service requiring no API key.

### Data returned per split

Temperature, feels-like temperature, precipitation probability, total precipitation, wind speed / direction / gusts, relative humidity, cloud cover, day/night flag, and a WMO weather code with icon and label.

### Coverage

| Situation                    | Data source         | Range         |
| ---------------------------- | ------------------- | ------------- |
| Course starts in the past    | Open-Meteo Archive  | Historical    |
| Course starts within 16 days | Open-Meteo Forecast | Up to 16 days |
| Course starts beyond 16 days | Not available       | Button hidden |

Long routes are split into batches of up to 50 unique locations per request. Each batch is fetched sequentially with a short delay to respect the free-tier rate limits (600 requests/min, 5,000/hour). Weather loads progressively — each batch populates the chart as it arrives. Results are cached in sessionStorage per location, so re-fetching the same route within a session is instant.

---

## 🗺️ Map Tile Layers

All three map views (course map, split endpoint map, transit segment map) support multiple tile layers switchable via a dropdown.

### Always available (no account required)

| Key             | Label             | Provider         |
| --------------- | ----------------- | ---------------- |
| `osm`           | Standard          | OpenStreetMap    |
| `topo`          | Topographic       | OpenTopoMap      |
| `cyclosm`       | CyclOSM           | OpenStreetMap FR |
| `cartoDark`     | Carto Dark Matter | CARTO            |
| `cartoPositron` | Carto Positron    | CARTO            |

### Available when `enable_google_maps` is set on your account

| Key               | Label            |
| ----------------- | ---------------- |
| `googleRoadmap`   | Google Maps      |
| `googleSatellite` | Google Satellite |
| `googleTerrain`   | Google Terrain   |
| `googleDark`      | Google Dark      |

Google tile layers require a server-side session token fetched from `/v1/cycling/google-tile-session`. They are hidden in the tile layer picker when the flag is not set.

The **Default Map Style** setting (in the Settings modal for signed-in users, or saved to localStorage for serverless mode) applies the chosen layer as the startup style in all map views.

---

## 🌐 Timezone Handling

### Course timezone

Every course has a primary IANA timezone (e.g. `America/Chicago`). All start times, ETA calculations, and open-hours checks use this timezone as the default throughout.

### Per-split timezone override

Individual splits can be assigned a different IANA timezone via the _Different timezone?_ checkbox. This is useful for routes that cross timezone boundaries mid-segment (common on long-distance events like Mishigami, which crosses entre Michigan).

When a GPX file is loaded, each split's endpoint timezone is **automatically detected** using the [tz-lookup](https://www.npmjs.com/package/tz-lookup) library, which performs a point-in-polygon lookup against a compact boundary dataset entirely in the browser — no geocoding API call required.

### Timezone-aware ETA badges

The results table checks each rest stop's open hours against the predicted arrival time in the _correct_ timezone for that split. Badges show:

| Badge         | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| 🟢 Open       | Arriving well within open hours (beyond both margin thresholds)  |
| 🟡 Near Open  | Arriving within the configured Near Open window (default 15 min) |
| 🟡 Near Close | Arriving within the configured Near Close window (default 7 min) |
| 🔴 Closed     | Arriving outside open hours                                      |

The Near Open / Near Close thresholds are configurable in the Settings modal (or saved to localStorage in serverless mode).

### Timezone shifts in results

The Projections tab detects when a segment crosses a timezone boundary (e.g. CDT → ET) and displays a timezone badge on the segment and split headers. This uses `Intl.DateTimeFormat` to resolve the short abbreviation of each split's end time in the appropriate IANA zone.

---

## 🟢 Open Hours & Rest Stop Configuration

Each split can have a rest stop with per-day open hours. Hours can be set identically for every day or configured per day of the week (Mon-Sun). The mode options are:

- **Hours** — opens/closes at specific times
- **24h** — open around the clock
- **Closed** — always closed on that day

The ETA badge in results reflects which day of the week the calculator predicts you'll arrive, resolved in the split's effective timezone. This means a stop that is open Monday-Friday 08:00-20:00 will correctly show as closed if your pacing puts you there on a Saturday night.

---

## �️ Planning & Projections Tabs

The form is divided into two tabs:

- **Planning** — edit segments, splits, speeds, rest stops, and course settings. The course name header, toolbar buttons (Export, Import, Quick Setup, Examples), and all form controls are here.
- **Projections** — view calculated results. Each segment shows elapsed time, pace, start/end times, and a breakdown of moving, down, and sleep time. Each split shows its pacing detail, ETA badge, and GPX split export. The Projections tab updates automatically as you edit in Planning.

---

## 🚌 Transit Segments

A transit segment represents a non-cycling leg of the course — a ferry crossing, shuttle transfer, train ride, or any fixed-duration movement. Toggle the **Transit Segment** switch inside any segment's settings to enable it.

- Enter a **Transit Time** (hours and minutes) and the **Distance** covered.
- The segment contributes fixed elapsed time and advances the course position by the set distance.
- Speed decay, down-time ratio, and moving-speed overrides are all ignored.
- Displayed with a fast-forward icon (⏩) in the segment header.
- Can include a rest stop (e.g. a ferry terminal) with open hours.

---

## � Browser & Device Support

This app requires a modern desktop or tablet browser.

| Viewport   | Support level                                                         |
| ---------- | --------------------------------------------------------------------- |
| ≥ 600 px   | Full — all features display correctly                                 |
| 390-599 px | Limited — most features work but maps, charts, and tables are cramped |
| < 390 px   | Not supported — layout issues expected                                |

The app is **not optimised for touch-only use**. GPX file uploads, map interactions, and multi-column forms work best with a keyboard and pointer device.

---

## 🗺️ Course Map & Elevation Profile

When a GPX file is loaded and split distances are configured, an interactive Leaflet map and elevation chart appear below the Course Settings form.

### Course map

- The full route is drawn as a colored polyline, with each segment shown in a distinct color matching the legend and segment collapse icon.
- Portions of the route not yet covered by any split are shown in light gray.
- Split endpoint markers are interactive — clicking one opens a popup with the split name, distance, and a **↓ Go to split** button that scrolls to and expands the corresponding form.
- Rest stop markers (purple) are hidden by default; use the **Rest Stops** toggle button on the map to show them.
- The **legend** is clickable: clicking a segment entry zooms the map to that segment's track portion and simultaneously zooms the elevation profile to that segment's distance range. Clicking the same entry again resets the elevation zoom.

### Elevation profile

- Always shows the **full course**, with each segment's range overlaid in its color.
- Click any area of the chart to zoom into that split's distance range. The header title updates to show what is in view (e.g. _Elevation: Segment 1 › Split 2_).
- The **↺ Reset** button returns the chart to the full-course view.
- Zooming in increases resolution: the chart always samples up to 300 points from the visible range, so smaller ranges reveal finer GPS detail.

---

## �🧩 Example Courses

The **Examples** button (toolbar) opens a modal with pre-built course configurations including their GPX routes. Loading an example replaces the current form state (with a confirmation prompt if you have unsaved data). The form auto-calculates immediately after loading.

### Included examples

| Example                 | Description                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simple Example**      | A single 100-mile segment split into two halves, demonstrating sub-split modes (even and fixed) and a real rest stop at Specialized Chicago with per-day hours.                                                   |
| **Complex Example**     | A multi-segment course with sleep time between segments, per-segment speed/delta overrides, and multiple timezones.                                                                                               |
| **Mishigami Challenge** | A two-segment, 1,121-mile plan modelled on the actual Mishigami ultra-endurance race across Michigan (Chicago → St Ignace → Chicago), with realistic speed delta settings, sleep windows, and timezone crossings. |
| **Trans Am Classic**    | The Trans Am Bike Race route with full GPX, demonstrating a large multi-segment course with Auto-Name city labels and elevation profile zoom.                                                                     |

Examples are defined as plain TypeScript objects in [`frontend/src/examples.ts`](./frontend/src/examples.ts). Adding a new example is as simple as adding an entry to the exported array — no build step or configuration change required.

---

## 🌍 APIs & External Services

| Service               | Used for                                                               | Key required?                 |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| **OpenStreetMap**     | OSM tile layer, Overpass nearby-stop search, Nominatim city labels     | No                            |
| **OpenTopoMap**       | Topographic tile layer                                                 | No                            |
| **CyclOSM**           | Cycling-focused tile layer                                             | No                            |
| **CARTO**             | Dark Matter and Positron tile layers                                   | No                            |
| **Overpass API**      | Nearby rest stop / amenity search                                      | No                            |
| **Nominatim**         | Reverse geocoding — nearest city label per split                       | No                            |
| **tz-lookup**         | Browser-side timezone detection from GPS coordinates (no network call) | No                            |
| **Open-Meteo**        | Hourly weather forecast and archive per split                          | No                            |
| **Google Maps Tiles** | Satellite, terrain, roadmap, dark tile layers (per-user feature flag)  | Backend-managed               |
| **Google Places**     | Free-text nearby stop search (per-user feature flag)                   | `GOOGLE_PLACES_API_KEY`       |
| **RideWithGPS**       | Route search and direct GPX import                                     | `RIDEWITHGPS_API_KEY` + OAuth |
| **Supabase**          | Google OAuth, user settings DB, race plan storage                      | `VITE_SUPABASE_*` keys        |

### Nominatim rate limiting

Nominatim's usage policy requires a maximum of **1 request per second**. The calculator enforces this with a sequential queue — city labels load one at a time with a 1.1 s gap between network requests. Coordinates that have been fetched in the current session are cached in memory and resolve instantly without a new request.
