"""Application configuration.

Everything here comes from environment variables so the Docker container can
be configured without touching code. Runtime-editable settings (AI profiles,
stores, categories) live in the database instead — see the spec, §4.3.
"""

import os


def _env_bool(name: str, default: bool = False) -> bool:
    """Parse a boolean-ish environment variable ("1", "true", "yes" → True)."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


# Where the SQLite database file lives. In Docker this is on a mounted volume.
DB_PATH = os.environ.get("SCRAN_DB_PATH", "./data/scran.db")

# Where uploaded photos are stored (second mounted volume in Docker).
UPLOADS_PATH = os.environ.get("SCRAN_UPLOADS_PATH", "./data/uploads")

# Secret used to sign/derive session tokens. MUST be set to a long random
# string in production (docker-compose.yml shows how). The insecure default
# only exists so local development works out of the box.
SESSION_SECRET = os.environ.get("SCRAN_SESSION_SECRET", "dev-insecure-secret")

# Session lifetime in days. Sessions are server-side (a `sessions` table),
# so changing this only affects newly created sessions.
SESSION_DAYS = int(os.environ.get("SCRAN_SESSION_DAYS", "30"))

# --- Trusted-proxy-header auth (SSO readiness, spec §2) -------------------
# Off by default. When enabled, requests arriving from one of the trusted
# proxy IPs may authenticate via a header (e.g. Remote-User set by
# Authelia/Authentik) instead of a session cookie.
AUTH_TRUST_HEADER = _env_bool("SCRAN_AUTH_TRUST_HEADER", False)
AUTH_HEADER_NAME = os.environ.get("SCRAN_AUTH_HEADER_NAME", "Remote-User")
# Comma-separated list of proxy IPs allowed to assert identity via header.
AUTH_TRUSTED_PROXY_IPS = [
    ip.strip()
    for ip in os.environ.get("SCRAN_AUTH_TRUSTED_PROXY_IPS", "").split(",")
    if ip.strip()
]

# --- First-run admin bootstrap ---------------------------------------------
# If the users table is empty at startup and both of these are set, an admin
# user is created automatically. After first login you can change the
# password and unset these variables.
INITIAL_ADMIN_USERNAME = os.environ.get("SCRAN_ADMIN_USERNAME", "")
INITIAL_ADMIN_PASSWORD = os.environ.get("SCRAN_ADMIN_PASSWORD", "")

# Directory containing the built frontend (served as static files). Empty or
# missing directory is fine during development (Vite serves the frontend).
FRONTEND_DIST = os.environ.get("SCRAN_FRONTEND_DIST", "../frontend/dist")
