"""Scran — household recipe manager. FastAPI application entry point.

One process serves the JSON API and (in production) the built React
frontend. Run in development with:

    uvicorn app.main:app --reload --port 8000
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, worker
from .auth.passwords import hash_password
from .auth.routes import router as auth_router
from .importer import router as importer_router
from .ingredients import router as ingredients_router
from .jobs import router as jobs_router
from .recipes import router as recipes_router
from .settings import router as settings_router
from .shopping import router as shopping_router

log = logging.getLogger("scran")
logging.basicConfig(level=logging.INFO)


def _bootstrap_admin() -> None:
    """Create the first admin user if the users table is empty (no self-signup,
    spec §2 — someone has to be able to log in after a fresh install)."""
    if not (config.INITIAL_ADMIN_USERNAME and config.INITIAL_ADMIN_PASSWORD):
        return
    conn = db.connect()
    try:
        if conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0:
            conn.execute(
                "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
                (
                    config.INITIAL_ADMIN_USERNAME,
                    hash_password(config.INITIAL_ADMIN_PASSWORD),
                ),
            )
            conn.commit()
            log.info("Created initial admin user %r", config.INITIAL_ADMIN_USERNAME)
    finally:
        conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    applied = db.run_migrations()
    if applied:
        log.info("Applied migrations: %s", ", ".join(applied))
    os.makedirs(config.UPLOADS_PATH, exist_ok=True)
    _bootstrap_admin()
    worker.start()
    yield
    worker.stop()


app = FastAPI(title="Scran", lifespan=lifespan)

app.include_router(auth_router)
app.include_router(recipes_router)
app.include_router(ingredients_router)
app.include_router(importer_router)
app.include_router(shopping_router)
app.include_router(jobs_router)
app.include_router(settings_router)


@app.get("/api/health")
def health():
    """Container healthcheck (spec §4.3). Touches the DB to prove it's usable."""
    conn = db.connect()
    try:
        conn.execute("SELECT 1")
    finally:
        conn.close()
    return {"status": "ok"}


# --- Frontend static serving (production container) -------------------------
# The built SPA lives in FRONTEND_DIST. Any non-API path falls back to
# index.html so client-side routing works on hard refresh.
_dist = Path(config.FRONTEND_DIST)
if _dist.is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
