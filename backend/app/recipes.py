"""Recipe CRUD, full-text search, photos, and cooking notes."""

import json
import re
import sqlite3
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import config
from .auth.deps import get_current_user
from .db import get_db
from .ingredients import enqueue_categorise_job, resolve_category

router = APIRouter(prefix="/api", tags=["recipes"])

ALLOWED_PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


# --- Request/response models -------------------------------------------------

class IngredientIn(BaseModel):
    amount: float | None = None
    unit: str | None = None
    name: str
    category_id: int | None = None
    scalable: bool = True


class RecipeIn(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    servings: int | None = None
    tags: list[str] = []
    source_url: str | None = None
    status: str = Field(default="draft", pattern="^(draft|published)$")
    ingredients: list[IngredientIn] = []
    steps: list[str] = []


class NoteIn(BaseModel):
    text: str = Field(min_length=1)


class VersionIn(RecipeIn):
    """Payload for "save as new version": the full edited recipe plus a label
    (e.g. "Less spicy", "Slow-cooker variant")."""
    version_label: str | None = None


# --- Helpers -----------------------------------------------------------------

def _fts_match(q: str) -> str | None:
    """Build a safe FTS5 MATCH expression: each word becomes a quoted prefix
    term, so user input can never inject FTS syntax."""
    tokens = re.findall(r"\w+", q, flags=re.UNICODE)
    if not tokens:
        return None
    return " ".join(f'"{t}"*' for t in tokens)


def _search_recipe_ids(db: sqlite3.Connection, q: str) -> list[int] | None:
    """Recipe ids matching the query across titles/descriptions, ingredient
    names, and cooking notes (spec §3.1, §3.1.1). None = no query given."""
    match = _fts_match(q)
    if match is None:
        return None
    rows = db.execute(
        "SELECT rowid AS id FROM recipes_fts WHERE recipes_fts MATCH :m"
        " UNION"
        " SELECT i.recipe_id FROM ingredients_fts f"
        "   JOIN ingredients i ON i.id = f.rowid WHERE ingredients_fts MATCH :m"
        " UNION"
        " SELECT n.recipe_id FROM recipe_notes_fts f"
        "   JOIN recipe_notes n ON n.id = f.rowid WHERE recipe_notes_fts MATCH :m",
        {"m": match},
    ).fetchall()
    return [r["id"] for r in rows]


def _summary(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "tags": json.loads(row["tags"]),
        "status": row["status"],
        "servings": row["servings"],
        "photo_path": row["photo_path"],
        "updated_at": row["updated_at"],
        "version_group": row["version_group"],
        "version_label": row["version_label"],
    }


def _save_children(db: sqlite3.Connection, recipe_id: int, body: RecipeIn) -> None:
    """(Re)write the ingredient and step rows for a recipe, running each
    ingredient through the categorisation flow (spec §3.6)."""
    db.execute("DELETE FROM ingredients WHERE recipe_id = ?", (recipe_id,))
    db.execute("DELETE FROM steps WHERE recipe_id = ?", (recipe_id,))

    needs_ai: list[str] = []
    for pos, ing in enumerate(body.ingredients):
        if not ing.name.strip():
            continue
        category_id, miss = resolve_category(db, ing.name, ing.category_id)
        if miss:
            needs_ai.append(ing.name)
        db.execute(
            "INSERT INTO ingredients"
            " (recipe_id, position, amount, unit, name, category_id, scalable)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (recipe_id, pos, ing.amount, ing.unit, ing.name.strip(),
             category_id, int(ing.scalable)),
        )
    for pos, text in enumerate(body.steps):
        if not text.strip():
            continue
        db.execute(
            "INSERT INTO steps (recipe_id, position, text) VALUES (?, ?, ?)",
            (recipe_id, pos, text.strip()),
        )
    enqueue_categorise_job(db, needs_ai)


def _get_recipe_or_404(db: sqlite3.Connection, recipe_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return row


# --- Recipe endpoints ----------------------------------------------------------

@router.get("/recipes")
def list_recipes(
    q: str = "",
    tag: str = "",
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    ids = _search_recipe_ids(db, q) if q.strip() else None
    if ids is not None and not ids:
        return []
    where, params = [], []
    if ids is not None:
        where.append(f"id IN ({','.join('?' * len(ids))})")
        params.extend(ids)
    if tag:
        # Tag filter matches against the JSON tags array, case-insensitively.
        where.append(
            "EXISTS (SELECT 1 FROM json_each(recipes.tags)"
            " WHERE json_each.value = ? COLLATE NOCASE)"
        )
        params.append(tag)
    # Browse shows only the newest version of each recipe group; older
    # versions remain reachable via the detail page's version switcher.
    where.append(
        "id IN (SELECT MAX(id) FROM recipes GROUP BY version_group)"
    )
    sql = "SELECT * FROM recipes"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY updated_at DESC"
    return [_summary(r) for r in db.execute(sql, params)]


@router.get("/recipes/tags")
def list_tags(db: sqlite3.Connection = Depends(get_db), user=Depends(get_current_user)):
    """Distinct tags across all recipes, most-used first (for filter chips)."""
    rows = db.execute(
        "SELECT json_each.value AS tag, COUNT(*) AS n"
        " FROM recipes, json_each(recipes.tags)"
        " GROUP BY json_each.value COLLATE NOCASE"
        " ORDER BY n DESC, tag"
    ).fetchall()
    return [r["tag"] for r in rows]


@router.get("/recipes/{recipe_id}")
def get_recipe(
    recipe_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _get_recipe_or_404(db, recipe_id)
    ingredients = [
        {
            "id": r["id"],
            "amount": r["amount"],
            "unit": r["unit"],
            "name": r["name"],
            "category_id": r["category_id"],
            "scalable": bool(r["scalable"]),
        }
        for r in db.execute(
            "SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY position",
            (recipe_id,),
        )
    ]
    steps = [
        r["text"]
        for r in db.execute(
            "SELECT text FROM steps WHERE recipe_id = ? ORDER BY position",
            (recipe_id,),
        )
    ]
    notes = [
        {
            "id": r["id"],
            "text": r["text"],
            "user_id": r["user_id"],
            "author": r["username"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in db.execute(
            "SELECT recipe_notes.*, users.username FROM recipe_notes"
            " JOIN users ON users.id = recipe_notes.user_id"
            " WHERE recipe_id = ? ORDER BY recipe_notes.created_at DESC,"
            " recipe_notes.id DESC",
            (recipe_id,),
        )
    ]
    versions = [
        {
            "id": r["id"],
            "version_label": r["version_label"],
            "created_at": r["created_at"],
        }
        for r in db.execute(
            "SELECT id, version_label, created_at FROM recipes"
            " WHERE version_group = ? ORDER BY id",
            (row["version_group"],),
        )
    ]
    return {
        **_summary(row),
        "description": row["description"],
        "source_url": row["source_url"],
        "created_at": row["created_at"],
        "ingredients": ingredients,
        "steps": steps,
        "notes": notes,
        "versions": versions,
    }


@router.post("/recipes", status_code=201)
def create_recipe(
    body: RecipeIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    cur = db.execute(
        "INSERT INTO recipes (title, description, servings, tags, source_url,"
        " status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (body.title.strip(), body.description, body.servings,
         json.dumps(body.tags), body.source_url, body.status, user["id"]),
    )
    recipe_id = cur.lastrowid
    # A brand-new recipe starts its own version group.
    db.execute(
        "UPDATE recipes SET version_group = ? WHERE id = ?", (recipe_id, recipe_id)
    )
    _save_children(db, recipe_id, body)
    db.commit()
    return get_recipe(recipe_id, db, user)


@router.put("/recipes/{recipe_id}")
def update_recipe(
    recipe_id: int,
    body: RecipeIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _get_recipe_or_404(db, recipe_id)
    db.execute(
        "UPDATE recipes SET title = ?, description = ?, servings = ?, tags = ?,"
        " source_url = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
        (body.title.strip(), body.description, body.servings,
         json.dumps(body.tags), body.source_url, body.status, recipe_id),
    )
    _save_children(db, recipe_id, body)
    db.commit()
    return get_recipe(recipe_id, db, user)


@router.delete("/recipes/{recipe_id}")
def delete_recipe(
    recipe_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _get_recipe_or_404(db, recipe_id)
    if row["photo_path"]:
        (Path(config.UPLOADS_PATH) / row["photo_path"]).unlink(missing_ok=True)
    db.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
    db.commit()
    return {"ok": True}


@router.post("/recipes/{recipe_id}/versions", status_code=201)
def save_as_version(
    recipe_id: int,
    body: VersionIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """User-triggered "save as new version": creates a new recipe row in the
    same version group, leaving the original untouched. The source recipe's
    photo is copied so each version keeps its own."""
    source = _get_recipe_or_404(db, recipe_id)
    cur = db.execute(
        "INSERT INTO recipes (title, description, servings, tags, source_url,"
        " status, created_by, version_group, version_label)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (body.title.strip(), body.description, body.servings,
         json.dumps(body.tags), body.source_url, body.status, user["id"],
         source["version_group"], (body.version_label or "").strip() or None),
    )
    new_id = cur.lastrowid
    _save_children(db, new_id, body)

    if source["photo_path"]:
        src = Path(config.UPLOADS_PATH) / source["photo_path"]
        if src.is_file():
            ext = src.suffix
            rel = f"recipes/{new_id}_{uuid.uuid4().hex[:8]}{ext}"
            dest = Path(config.UPLOADS_PATH) / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())
            db.execute("UPDATE recipes SET photo_path = ? WHERE id = ?", (rel, new_id))

    db.commit()
    return get_recipe(new_id, db, user)


# --- Photos --------------------------------------------------------------------

@router.post("/recipes/{recipe_id}/photo")
def upload_photo(
    recipe_id: int,
    photo: UploadFile,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _get_recipe_or_404(db, recipe_id)
    ext = Path(photo.filename or "").suffix.lower()
    if ext not in ALLOWED_PHOTO_EXTS:
        raise HTTPException(status_code=400, detail="Use a JPEG, PNG, or WebP image")

    # Random filename: avoids collisions and cache-staleness after replacing.
    rel = f"recipes/{recipe_id}_{uuid.uuid4().hex[:8]}{ext}"
    dest = Path(config.UPLOADS_PATH) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(photo.file.read())

    if row["photo_path"]:
        (Path(config.UPLOADS_PATH) / row["photo_path"]).unlink(missing_ok=True)
    db.execute(
        "UPDATE recipes SET photo_path = ?, updated_at = datetime('now')"
        " WHERE id = ?",
        (rel, recipe_id),
    )
    db.commit()
    return {"photo_path": rel}


@router.get("/uploads/{rel_path:path}")
def serve_upload(rel_path: str, user=Depends(get_current_user)):
    """Serve uploaded photos (login required — this is household data)."""
    base = Path(config.UPLOADS_PATH).resolve()
    target = (base / rel_path).resolve()
    # resolve() + relative_to guards against ../ path traversal.
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)


# --- Cooking notes (spec §3.1.1) ------------------------------------------------

@router.post("/recipes/{recipe_id}/notes", status_code=201)
def add_note(
    recipe_id: int,
    body: NoteIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _get_recipe_or_404(db, recipe_id)
    cur = db.execute(
        "INSERT INTO recipe_notes (recipe_id, user_id, text) VALUES (?, ?, ?)",
        (recipe_id, user["id"], body.text.strip()),
    )
    db.commit()
    row = db.execute(
        "SELECT recipe_notes.*, users.username FROM recipe_notes"
        " JOIN users ON users.id = recipe_notes.user_id WHERE recipe_notes.id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return {
        "id": row["id"],
        "text": row["text"],
        "user_id": row["user_id"],
        "author": row["username"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _get_own_note_or_403(db: sqlite3.Connection, note_id: int, user) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM recipe_notes WHERE id = ?", (note_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Note not found")
    # A note's author (or an admin) may modify it (spec §3.1.1).
    if row["user_id"] != user["id"] and not user["is_admin"]:
        raise HTTPException(status_code=403, detail="You can only edit your own notes")
    return row


@router.put("/notes/{note_id}")
def edit_note(
    note_id: int,
    body: NoteIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _get_own_note_or_403(db, note_id, user)
    db.execute(
        "UPDATE recipe_notes SET text = ?, updated_at = datetime('now')"
        " WHERE id = ?",
        (body.text.strip(), note_id),
    )
    db.commit()
    return {"ok": True}


@router.delete("/notes/{note_id}")
def delete_note(
    note_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _get_own_note_or_403(db, note_id, user)
    db.execute("DELETE FROM recipe_notes WHERE id = ?", (note_id,))
    db.commit()
    return {"ok": True}
