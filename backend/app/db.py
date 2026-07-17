"""SQLite connection handling and the migration runner.

Design choices (spec §4.1, §7):
- Plain sqlite3 from the standard library — no ORM, keeps things readable.
- WAL journal mode so reads don't block writes.
- Migrations are numbered .sql files in app/migrations/, applied in order at
  startup and tracked in a schema_migrations table. Adding a feature later
  means dropping a new 00N_*.sql file in that directory — nothing else.
"""

import os
import re
import sqlite3
from pathlib import Path

from . import config

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

# The original 001-009 chain was squashed into a single 001_initial.sql at
# v0.2.13. A database fully migrated before the squash already records
# "001_initial.sql" and simply skips the baseline; one stuck partway through
# the old chain can't be brought forward by the squashed file, so startup
# refuses with instructions rather than running with a drifted schema.
LEGACY_MIGRATIONS = {
    "002_recipe_versions.sql",
    "003_ingredient_note.sql",
    "004_jobs_expand_types.sql",
    "005_source_page_text.sql",
    "006_ingredient_section.sql",
    "007_job_recipe_link.sql",
    "008_video_import.sql",
    "009_shopping_lists.sql",
}
_UPGRADE_MSG = (
    "This database was created before the migration squash and is only "
    "partially migrated. Run Scran v0.2.13 (the last pre-squash release) "
    "against it once to bring it up to date, then upgrade."
)


def connect() -> sqlite3.Connection:
    """Open a new connection with our standard pragmas applied.

    FastAPI endpoints get one connection per request via the `get_db`
    dependency below; scripts and the worker can call this directly.
    """
    # check_same_thread=False: FastAPI runs sync endpoints in a threadpool, so
    # the request's connection may be used from a different thread than the
    # one that opened it. Each connection is per-request (never shared
    # concurrently), so this is safe.
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row  # rows behave like dicts: row["name"]
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db():
    """FastAPI dependency: yields a connection, always closes it after."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def run_migrations() -> list[str]:
    """Apply any not-yet-applied migrations, in filename order.

    Returns the list of migration filenames applied (useful for logging).
    Called automatically on app startup (spec §7: migrations run on
    container start).
    """
    os.makedirs(os.path.dirname(os.path.abspath(config.DB_PATH)), exist_ok=True)
    conn = connect()
    applied: list[str] = []
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "  filename TEXT PRIMARY KEY,"
            "  applied_at TEXT NOT NULL DEFAULT (datetime('now'))"
            ")"
        )
        done = {
            row["filename"]
            for row in conn.execute("SELECT filename FROM schema_migrations")
        }
        # Pre-squash databases (see LEGACY_MIGRATIONS above): fully migrated
        # ones pass both checks and skip the baseline by filename; partially
        # migrated ones must finish the old chain on v0.2.13 first.
        legacy_done = done & LEGACY_MIGRATIONS
        if legacy_done and legacy_done != LEGACY_MIGRATIONS:
            raise RuntimeError(_UPGRADE_MSG)
        if "001_initial.sql" in done and not legacy_done:
            # Either a fresh post-squash install or an ancient DB that only
            # ever applied the original 001 — told apart by a table the old
            # chain added at its end (009).
            has_lists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shopping_lists'"
            ).fetchone()
            if not has_lists:
                raise RuntimeError(_UPGRADE_MSG)
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            # Enforce the NNN_name.sql convention so ordering is explicit.
            if not re.match(r"^\d{3}_", path.name):
                raise RuntimeError(f"Migration {path.name} must start with 3 digits")
            if path.name in done:
                continue
            conn.executescript(path.read_text())
            conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES (?)", (path.name,)
            )
            conn.commit()
            applied.append(path.name)
    finally:
        conn.close()
    return applied
