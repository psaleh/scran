"""Server-side sessions.

The browser cookie holds a random 256-bit token. The database stores only a
keyed hash of it (HMAC with the session secret), so neither a stolen database
nor a leaked secret alone is enough to forge a session. Sessions being
server-side also means "log out" and "delete user" genuinely revoke access.
"""

import hashlib
import hmac
import secrets
import sqlite3

from .. import config

COOKIE_NAME = "scran_session"


def _hash_token(token: str) -> str:
    return hmac.new(
        config.SESSION_SECRET.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def create_session(db: sqlite3.Connection, user_id: int) -> str:
    """Create a session row and return the raw token for the cookie."""
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at)"
        " VALUES (?, ?, datetime('now', ?))",
        (_hash_token(token), user_id, f"+{config.SESSION_DAYS} days"),
    )
    db.commit()
    return token


def get_user_for_token(db: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """Return the user row for a valid, unexpired session token, else None."""
    return db.execute(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id"
        " WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')",
        (_hash_token(token),),
    ).fetchone()


def delete_session(db: sqlite3.Connection, token: str) -> None:
    db.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
    # Opportunistically sweep expired sessions while we're here.
    db.execute("DELETE FROM sessions WHERE expires_at <= datetime('now')")
    db.commit()
