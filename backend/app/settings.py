"""Settings APIs: users (admin only), categories, and AI profiles.

Runtime-editable settings live in the database (spec §4.3). Auth options are
environment configuration, so they're exposed read-only for display.
API keys are stored server-side and NEVER returned to the browser (§7).
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import config
from .auth.deps import get_current_admin, get_current_user
from .auth.passwords import hash_password
from .db import get_db

router = APIRouter(prefix="/api", tags=["settings"])


# --- Users (admin only, spec §2: created by an admin, no self-signup) ---------

class UserIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8)
    is_admin: bool = False


class UserPatch(BaseModel):
    password: str | None = Field(default=None, min_length=8)
    is_admin: bool | None = None


def _public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
        "created_at": row["created_at"],
    }


def _admin_count(db: sqlite3.Connection) -> int:
    return db.execute(
        "SELECT COUNT(*) AS n FROM users WHERE is_admin = 1"
    ).fetchone()["n"]


@router.get("/users")
def list_users(db: sqlite3.Connection = Depends(get_db), admin=Depends(get_current_admin)):
    return [_public_user(r) for r in db.execute("SELECT * FROM users ORDER BY username")]


@router.post("/users", status_code=201)
def create_user(
    body: UserIn,
    db: sqlite3.Connection = Depends(get_db),
    admin=Depends(get_current_admin),
):
    try:
        cur = db.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
            (body.username.strip(), hash_password(body.password), int(body.is_admin)),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That username is taken")
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _public_user(row)


@router.patch("/users/{user_id}")
def patch_user(
    user_id: int,
    body: UserPatch,
    db: sqlite3.Connection = Depends(get_db),
    admin=Depends(get_current_admin),
):
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.password:
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(body.password), user_id),
        )
        # Password change invalidates that user's existing sessions.
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    if body.is_admin is not None:
        # Never demote the last admin — the household would be locked out.
        if row["is_admin"] and not body.is_admin and _admin_count(db) <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        db.execute(
            "UPDATE users SET is_admin = ? WHERE id = ?",
            (int(body.is_admin), user_id),
        )
    db.commit()
    return _public_user(db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: sqlite3.Connection = Depends(get_db),
    admin=Depends(get_current_admin),
):
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete yourself")
    if row["is_admin"] and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    # Detach shared household data, then remove the account. Their cooking
    # notes go with them (author-attributed content).
    db.execute("UPDATE recipes SET created_by = NULL WHERE created_by = ?", (user_id,))
    db.execute("UPDATE shopping_items SET added_by = NULL WHERE added_by = ?", (user_id,))
    db.execute("DELETE FROM recipe_notes WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()
    return {"ok": True}


# --- Categories (spec §3.5) -----------------------------------------------------

class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


@router.post("/categories", status_code=201)
def create_category(
    body: CategoryIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        cur = db.execute("INSERT INTO categories (name) VALUES (?)", (body.name.strip(),))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That category already exists")
    # New categories default to the end of every store's walking route (§3.5).
    for store in db.execute("SELECT id FROM stores"):
        pos = db.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM store_category_order"
            " WHERE store_id = ?",
            (store["id"],),
        ).fetchone()["p"]
        db.execute(
            "INSERT INTO store_category_order (store_id, category_id, position)"
            " VALUES (?, ?, ?)",
            (store["id"], cur.lastrowid, pos),
        )
    db.commit()
    return {"id": cur.lastrowid, "name": body.name.strip()}


@router.put("/categories/{category_id}")
def rename_category(
    category_id: int,
    body: CategoryIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    if db.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Category not found")
    try:
        db.execute("UPDATE categories SET name = ? WHERE id = ?", (body.name.strip(), category_id))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That category already exists")
    db.commit()
    return {"id": category_id, "name": body.name.strip()}


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    if db.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Category not found")
    # FKs handle the fallout: store orders cascade; ingredients, shopping
    # items, and lookup rows fall back to NULL (uncategorised).
    db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    db.commit()
    return {"ok": True}


# --- AI profiles (spec §5.1) -------------------------------------------------------

class AiProfileIn(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    # Empty/omitted on update means "keep the stored key".
    api_key: str | None = None


def _profile(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "model": row["model"],
        "is_default": bool(row["is_default"]),
        # The key itself never leaves the server.
        "has_key": bool(row["api_key"]),
    }


@router.get("/ai-profiles")
def list_profiles(db: sqlite3.Connection = Depends(get_db), user=Depends(get_current_user)):
    return [_profile(r) for r in db.execute("SELECT * FROM ai_profiles ORDER BY name")]


@router.post("/ai-profiles", status_code=201)
def create_profile(
    body: AiProfileIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        cur = db.execute(
            "INSERT INTO ai_profiles (name, base_url, api_key, model) VALUES (?, ?, ?, ?)",
            (body.name.strip(), body.base_url.strip(), body.api_key or "", body.model.strip()),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="A profile with that name exists")
    # First profile automatically becomes the active one.
    if db.execute("SELECT COUNT(*) AS n FROM ai_profiles").fetchone()["n"] == 1:
        db.execute("UPDATE ai_profiles SET is_default = 1 WHERE id = ?", (cur.lastrowid,))
    db.commit()
    return _profile(db.execute("SELECT * FROM ai_profiles WHERE id = ?", (cur.lastrowid,)).fetchone())


@router.put("/ai-profiles/{profile_id}")
def update_profile(
    profile_id: int,
    body: AiProfileIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = db.execute("SELECT * FROM ai_profiles WHERE id = ?", (profile_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.execute(
        "UPDATE ai_profiles SET name = ?, base_url = ?, model = ?, api_key = ?"
        " WHERE id = ?",
        (body.name.strip(), body.base_url.strip(), body.model.strip(),
         body.api_key if body.api_key else row["api_key"], profile_id),
    )
    db.commit()
    return _profile(db.execute("SELECT * FROM ai_profiles WHERE id = ?", (profile_id,)).fetchone())


@router.post("/ai-profiles/{profile_id}/activate")
def activate_profile(
    profile_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    if db.execute("SELECT 1 FROM ai_profiles WHERE id = ?", (profile_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.execute("UPDATE ai_profiles SET is_default = 0")
    db.execute("UPDATE ai_profiles SET is_default = 1 WHERE id = ?", (profile_id,))
    db.commit()
    return {"ok": True}


@router.delete("/ai-profiles/{profile_id}")
def delete_profile(
    profile_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    if db.execute("SELECT 1 FROM ai_profiles WHERE id = ?", (profile_id,)).fetchone() is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    db.execute("DELETE FROM ai_profiles WHERE id = ?", (profile_id,))
    db.commit()
    return {"ok": True}


# --- Auth configuration (read-only: comes from environment variables) --------------

@router.get("/settings/auth")
def auth_settings(admin=Depends(get_current_admin)):
    return {
        "trust_header": config.AUTH_TRUST_HEADER,
        "header_name": config.AUTH_HEADER_NAME,
        "trusted_proxy_ips": config.AUTH_TRUSTED_PROXY_IPS,
    }
