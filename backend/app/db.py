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


def connect() -> sqlite3.Connection:
    """Open a new connection with our standard pragmas applied.

    FastAPI endpoints get one connection per request via the `get_db`
    dependency below; scripts and the worker can call this directly.
    """
    conn = sqlite3.connect(config.DB_PATH)
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
