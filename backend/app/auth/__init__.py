"""Authentication module.

Deliberately isolated from the rest of the app (spec §2, SSO-ready):
- passwords.py — bcrypt hashing
- sessions.py  — server-side session store (cookie holds a random token)
- deps.py      — FastAPI dependencies (current_user, admin_required),
                 including optional trusted-proxy-header auth
- routes.py    — /api/auth/* endpoints

Nothing outside this package touches password hashes, cookies, or the
Remote-User header; the rest of the app only ever asks deps.py "who is the
current user?".
"""
