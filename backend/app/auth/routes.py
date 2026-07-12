"""Auth endpoints: login, logout, and "who am I?"."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from ..db import get_db
from . import sessions
from .deps import get_current_user
from .passwords import verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


def _public_user(user) -> dict:
    """The user fields the browser is allowed to see."""
    return {
        "id": user["id"],
        "username": user["username"],
        "is_admin": bool(user["is_admin"]),
    }


@router.post("/login")
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: sqlite3.Connection = Depends(get_db),
):
    user = db.execute(
        "SELECT * FROM users WHERE username = ?", (body.username.strip(),)
    ).fetchone()
    # Same error for unknown user and wrong password — don't leak which.
    if user is None or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = sessions.create_session(db, user["id"])
    response.set_cookie(
        sessions.COOKIE_NAME,
        token,
        max_age=60 * 60 * 24 * 365,  # cookie outlives session; server side expires it
        httponly=True,               # not readable from JavaScript
        samesite="lax",
        # Only mark Secure when the request actually came in over HTTPS, so
        # plain-HTTP homelab access still works.
        secure=request.url.scheme == "https",
        path="/",
    )
    return _public_user(user)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: sqlite3.Connection = Depends(get_db),
):
    token = request.cookies.get(sessions.COOKIE_NAME)
    if token:
        sessions.delete_session(db, token)
    response.delete_cookie(sessions.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user=Depends(get_current_user)):
    return _public_user(user)
