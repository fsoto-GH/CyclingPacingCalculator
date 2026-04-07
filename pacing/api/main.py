import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from pacing.api.routes.calculator import v1_calculator

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_calculator.router)

# Serve the built React frontend if the static/ directory exists
_static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "static")
if os.path.isdir(_static_dir):
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(_static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_static_dir, "index.html"))

if __name__ == '__main__':
    # this is to help debug
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
