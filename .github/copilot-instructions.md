# Copilot Instructions for CyclingPacingCalculator

## Build, test, and lint commands

### Frontend (`frontend/`)

- Install deps: `npm install`
- Dev server with HMR: `npm run dev`
- Production build: `npm run build`
- Lint: `npm run lint`

### Full stack / backend

- Install Python deps from repo root: `pip install -r requirements.txt`
- Run the API locally from repo root: `uvicorn pacing.api.main:app --host 0.0.0.0 --port 8000 --reload`
- Run the containerized app: `docker compose up -d --build`
- Stop containers: `docker compose down`

### Tests

- There is no automated test suite checked in right now, so there is no single-test command to run.

## High-level architecture

- The repo has three layers that share the same pacing model:
  1. `frontend/`: React + Vite SPA.
  2. `pacing/api/`: FastAPI wrapper around the calculator.
  3. `pacing/calculator/`: standalone Python pacing engine, also used directly by scripts in `pacing/examples/`.

- `frontend/src/components/CourseForm.tsx` is the main orchestration component. It owns the editable course form, persistence, GPX loading, reverse geocoding, timezone detection, auto-calculation, and the handoff to `ResultsView`.

- The frontend keeps form state in UI-friendly string fields, then converts it through `frontend/src/serialization.ts` into a shared `CoursePayload`. That payload is the contract between the UI and both calculator engines.

- Calculation can run in two interchangeable paths selected by the `?engine=` query param:
  - `client` (default): `frontend/src/calculator/courseProcessor.ts`
  - `api`: POST to `/v1/cycling/calculator` via `frontend/src/api.ts`

- `ResultsView` expects the same `CourseDetail` shape from either path. If you change calculator behavior or response fields, keep the TypeScript client calculator, the FastAPI DTO layer, and the Python calculator in sync.

- Backend request flow is:
  1. FastAPI route in `pacing/api/routes/calculator/v1_calculator.py`
  2. validation + API-to-core DTO mapping in `pacing/api/routes/calculator/service/course_service.py`
  3. core processing in `pacing/calculator/service/calculations/course_processor.py` and `segment_processor.py`

- In production, FastAPI also serves the built SPA from `static/`. Docker builds the frontend first, then starts the API that serves both `/` and `/v1/...`.

- GPX parsing, elevation/profile analysis, timezone lookup, nearby-stop lookup, and reverse geocoding are browser-side features in `frontend/src/calculator/` and are wired back into the form/results UI rather than the backend.

## Key conventions

- Treat the serialized payload shape as the source of truth between layers. UI code should work with form-state types from `frontend/src/types.ts`, then use `serializeCourse()` instead of hand-building API payloads.

- Keep parity between the Python and TypeScript calculators. The client calculator in `frontend/src/calculator/courseProcessor.ts` intentionally mirrors validation, target-distance normalization, split/segment override behavior, and result shape from the Python calculator.

- `target_distance` mode stores cumulative distance markers in the form, but both calculators normalize them into per-split distances before computation. GPX slicing logic in `CourseForm.tsx` mirrors that same normalization; changes to one side usually require changes to the others.

- Override precedence matters: course defaults flow into segment overrides, then split overrides. A split-level moving-speed override becomes the current speed before split decay is applied to later splits.

- Timezone handling is deliberate. Course start time is entered as wall-clock time in the selected course timezone and converted with `tzLocalStringToUtcIso()`; split endpoints can carry their own timezone override for downstream display and ETA logic.

- Persistence is split by data type:
  - form JSON lives in `localStorage`
  - raw GPX XML lives in IndexedDB via `frontend/src/gpxStore.ts`
  Imported courses can reconnect to a stored GPX by filename, so preserve that behavior when changing import/export.

- `CourseForm.tsx` contains migration logic for older saved data (`split_decay` rename, split-delta sign inversion, rest-stop shape changes, timezone field moves). Do not remove or bypass those migrations when changing saved form structure.

- GPX-derived enrichments are intentionally throttled/debounced. Profile recomputation, city-label lookup, and map-heavy features are designed to avoid excessive browser work and external API traffic.
