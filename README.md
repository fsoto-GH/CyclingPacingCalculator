# 🚴‍♂️ CyclingPacingCalculator

## 🧠 Why I Built This

Multi-day ultra-endurance cycling events don't have a simple finish time. Your speed decays as fatigue accumulates. Sleep windows eat into your clock. Rest stops, aid stations, and segments with different terrain all compound into a final elapsed time that is nearly impossible to estimate in your head.

Before Mishigami 2025—a 1,121-mile race across Michigan—I needed a way to model different pacing strategies and understand the tradeoffs. How fast could I afford to start? How much would a 3-hour sleep window cost me versus a 1-hour nap? What happens if my average speed drops by 1 mph in the final 200 miles?

I built this calculator to answer those questions. It powered my race plan for Mishigami, where I finished 2nd place—the first Chicagoan ever to complete the race in under 4 days.

While the race is over, I plan to continue enhancing this project. I'd like to ultimately have:

- GPX route support to split and visualize the route
- Allow for GPX route analysis (insights into elevation gain — hilly segments or splits) to aid in planning
- A way to, on-the-fly, find and select rest stops to ultimately export

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

| Scenario | What to do |
|---|---|
| Changed Python code | `docker compose up -d` (no `--build`) — `--reload` picks it up automatically |
| Changed frontend code | `docker compose up -d --build` to rebuild the image |
| Frontend dev with HMR | Run `npm run dev` separately (proxies API to `localhost:8000`) |

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
