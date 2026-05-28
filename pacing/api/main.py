import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from pacing.api.config import settings
from pacing.api.database import Base, engine
from pacing.api.routes.calculator import v1_calculator
from pacing.api.routes.cycling import nearby_stops, forecast, google_tiles
from pacing.api.routes.cycling.gpx import oauth as gpx_oauth
from pacing.api.routes.cycling.race_plan import router as race_plan_router
from pacing.api.routes import auth as auth_router
from pacing.api.routes import user_settings as user_settings_router

# Ensure all ORM models are registered with the metadata before create_all.
import pacing.api.models  # noqa: F401

# Create tables on startup (no-op if they already exist).
# For production schema migrations, prefer Alembic instead.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Cycling Pacing Calculator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(v1_calculator.router)
app.include_router(nearby_stops.router)
app.include_router(forecast.router)
app.include_router(google_tiles.router)
app.include_router(gpx_oauth.router)
app.include_router(race_plan_router.router)
app.include_router(user_settings_router.router)

# ── SPA fallback ──────────────────────────────────────────────────────────────
_static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "static")
if os.path.isdir(_static_dir):
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(_static_dir, full_path)
        if os.path.isfile(file_path):
            response = FileResponse(file_path)
            # Hashed assets (JS/CSS) can be cached indefinitely
            if "/assets/" in full_path:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        # SPA fallback — always return index.html uncached so the browser
        # picks up new builds immediately
        response = FileResponse(os.path.join(_static_dir, "index.html"))
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

if __name__ == '__main__':
    # this is to help debug
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
