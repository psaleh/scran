"""FastAPI dependencies that answer "who is making this request?".

Two identity sources, checked in order:
1. Trusted-proxy header (only if enabled AND the request comes from a
   configured proxy IP) — the SSO path for Authelia/Authentik (spec §2).
2. The session cookie — the normal username/password path.
"""

import sqlite3

from fastapi import Depends, HTTPException, Request

from .. import config
from ..db import get_db
from . import sessions


def _user_from_trusted_header(request: Request, db: sqlite3.Connection):
    """Resolve identity from the reverse-proxy header, if that mode is on.

    The header is only honoured when the direct peer IP is in the configured
    allowlist — otherwise anyone who can reach the app could impersonate any
    user by sending the header themselves.
    """
    if not config.AUTH_TRUST_HEADER:
        return None
    peer_ip = request.client.host if request.client else None
    if peer_ip not in config.AUTH_TRUSTED_PROXY_IPS:
        return None
    username = request.headers.get(config.AUTH_HEADER_NAME)
    if not username:
        return None
    # The proxy has already authenticated this person; we just need a matching
    # local user row (users are still created by the admin, spec §2).
    return db.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()


def get_current_user(request: Request, db: sqlite3.Connection = Depends(get_db)):
    """Dependency: the logged-in user row, or 401."""
    user = _user_from_trusted_header(request, db)
    if user is None:
        token = request.cookies.get(sessions.COOKIE_NAME)
        if token:
            user = sessions.get_user_for_token(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def get_current_admin(user=Depends(get_current_user)):
    """Dependency: like get_current_user but requires the admin flag."""
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
