"""Shared household shopping list (spec §3.4) and stores (§3.5).

Items are COPIES of ingredient data: sending an ingredient to the list copies
name/amount/unit/category and records the originating recipe_id as a tag.
Editing a recipe never changes the list and vice versa (settled decision).
Duplicates are never merged — the UI groups same-name items adjacently.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth.deps import get_current_user
from .db import get_db
from .ingredients import enqueue_categorise_job, resolve_category

router = APIRouter(prefix="/api", tags=["shopping"])


# --- Models ------------------------------------------------------------------

class ManualItemIn(BaseModel):
    name: str = Field(min_length=1)
    amount: float | None = None
    unit: str | None = None
    # Set when the user picked an autocomplete suggestion (known category).
    category_id: int | None = None
    note: str | None = None
    # Optional: lets an undone item keep the recipe tag and checked state it
    # had before it was removed (the recipe_id itself isn't validated here —
    # a stale id just means the tag silently doesn't resolve to a title).
    recipe_id: int | None = None
    checked: bool = False
    # Target list; omitted (or stale, e.g. undo after the list was deleted)
    # falls back to the default list so items are never lost.
    list_id: int | None = None


class FromRecipeIn(BaseModel):
    recipe_id: int
    # Specific ingredient ids, or empty/omitted = all ingredients ("add all").
    ingredient_ids: list[int] = []


class ItemPatch(BaseModel):
    name: str | None = None
    amount: float | None = None
    unit: str | None = None
    category_id: int | None = None
    checked: bool | None = None
    # Distinguish "recategorise to X" from "field not sent": the client sets
    # this flag when category_id is intentionally part of the patch.
    set_category: bool = False
    note: str | None = None
    # Full edit from the row dialog: when set, name/amount/unit/note are
    # written exactly as sent, so a blank amount/unit/note clears it (the
    # plain fields above only ever fill values in — see patch_item).
    set_details: bool = False
    # Move the item to another list. No set_* flag needed — moving to NULL is
    # never meaningful, unlike category_id.
    list_id: int | None = None


class ShoppingListIn(BaseModel):
    name: str = Field(min_length=1)


class StoreIn(BaseModel):
    name: str = Field(min_length=1)
    category_order: list[int] | None = None


# --- Helpers -------------------------------------------------------------------

def _default_list_id(db: sqlite3.Connection) -> int:
    return db.execute(
        "SELECT id FROM shopping_lists WHERE is_default = 1"
    ).fetchone()["id"]


def _item(row: sqlite3.Row, default_list_id: int) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "amount": row["amount"],
        "unit": row["unit"],
        # Copied for completeness; the list UI de-emphasises it (spec §4.4).
        "note": row["note"],
        "category_id": row["category_id"],
        "recipe_id": row["recipe_id"],
        "recipe_title": row["recipe_title"],
        "checked": bool(row["checked"]),
        "created_at": row["created_at"],
        # NULL means the default list (the column was added by ALTER TABLE, so
        # NOT NULL wasn't possible — migration 009).
        "list_id": row["list_id"] or default_list_id,
    }


def _fetch_item(db: sqlite3.Connection, item_id: int) -> dict:
    row = db.execute(
        "SELECT shopping_items.*, recipes.title AS recipe_title"
        " FROM shopping_items LEFT JOIN recipes ON recipes.id = shopping_items.recipe_id"
        " WHERE shopping_items.id = ?",
        (item_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item(row, _default_list_id(db))


# --- Shopping items --------------------------------------------------------------

@router.get("/shopping")
def list_items(db: sqlite3.Connection = Depends(get_db), user=Depends(get_current_user)):
    rows = db.execute(
        "SELECT shopping_items.*, recipes.title AS recipe_title"
        " FROM shopping_items LEFT JOIN recipes ON recipes.id = shopping_items.recipe_id"
        " ORDER BY shopping_items.id"
    ).fetchall()
    default = _default_list_id(db)
    return [_item(r, default) for r in rows]


@router.post("/shopping", status_code=201)
def add_manual_item(
    body: ManualItemIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """Manual add — same categorisation flow as the recipe editor (§3.6)."""
    category_id, miss = resolve_category(db, body.name, body.category_id)
    if miss:
        enqueue_categorise_job(db, [body.name])
    list_id = _default_list_id(db)
    if body.list_id is not None and db.execute(
        "SELECT id FROM shopping_lists WHERE id = ?", (body.list_id,)
    ).fetchone():
        list_id = body.list_id
    cur = db.execute(
        "INSERT INTO shopping_items (name, amount, unit, note, category_id,"
        " recipe_id, checked, added_by, list_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (body.name.strip(), body.amount, body.unit or None, body.note,
         category_id, body.recipe_id, int(body.checked), user["id"], list_id),
    )
    db.commit()
    return _fetch_item(db, cur.lastrowid)


@router.post("/shopping/from-recipe", status_code=201)
def add_from_recipe(
    body: FromRecipeIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """Copy ingredients from a recipe onto the list (per-item or add-all)."""
    recipe = db.execute(
        "SELECT id FROM recipes WHERE id = ?", (body.recipe_id,)
    ).fetchone()
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    sql = "SELECT * FROM ingredients WHERE recipe_id = ?"
    params: list = [body.recipe_id]
    if body.ingredient_ids:
        sql += f" AND id IN ({','.join('?' * len(body.ingredient_ids))})"
        params.extend(body.ingredient_ids)
    ingredients = db.execute(sql + " ORDER BY position", params).fetchall()
    if not ingredients:
        raise HTTPException(status_code=404, detail="No matching ingredients")

    # Recipe sends always land on the default list; items can be moved to
    # another list afterwards from the shopping list page.
    list_id = _default_list_id(db)
    created = []
    for ing in ingredients:
        cur = db.execute(
            "INSERT INTO shopping_items (name, amount, unit, note, category_id,"
            " recipe_id, added_by, list_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (ing["name"], ing["amount"], ing["unit"], ing["note"],
             ing["category_id"], body.recipe_id, user["id"], list_id),
        )
        created.append(cur.lastrowid)
    db.commit()
    return [_fetch_item(db, item_id) for item_id in created]


@router.patch("/shopping/{item_id}")
def patch_item(
    item_id: int,
    body: ItemPatch,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    item = _fetch_item(db, item_id)

    if body.set_category:
        # Manual recategorisation sticks for the future (§3.6.4).
        db.execute(
            "INSERT INTO ingredient_lookup (ingredient_name, category_id, use_count)"
            " VALUES (?, ?, 1)"
            " ON CONFLICT(ingredient_name)"
            " DO UPDATE SET category_id = excluded.category_id",
            # A rename in the same edit should teach the lookup the new name.
            ((body.name if body.set_details and body.name else item["name"]).strip().lower(),
             body.category_id),
        )
        db.execute(
            "UPDATE shopping_items SET category_id = ? WHERE id = ?",
            (body.category_id, item_id),
        )
    if body.checked is not None:
        db.execute(
            "UPDATE shopping_items SET checked = ? WHERE id = ?",
            (int(body.checked), item_id),
        )
    if body.set_details:
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        db.execute(
            "UPDATE shopping_items SET name = ?, amount = ?, unit = ?, note = ?"
            " WHERE id = ?",
            (
                name,
                body.amount,
                (body.unit or "").strip() or None,
                (body.note or "").strip() or None,
                item_id,
            ),
        )
    elif body.name is not None and body.name.strip():
        db.execute(
            "UPDATE shopping_items SET name = ? WHERE id = ?",
            (body.name.strip(), item_id),
        )
    if not body.set_details and (body.amount is not None or body.unit is not None):
        db.execute(
            "UPDATE shopping_items SET amount = COALESCE(?, amount),"
            " unit = COALESCE(?, unit) WHERE id = ?",
            (body.amount, body.unit, item_id),
        )
    if body.list_id is not None:
        # Move (never copy) the item to another list.
        if db.execute(
            "SELECT id FROM shopping_lists WHERE id = ?", (body.list_id,)
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail="List not found")
        db.execute(
            "UPDATE shopping_items SET list_id = ? WHERE id = ?",
            (body.list_id, item_id),
        )
    db.commit()
    return _fetch_item(db, item_id)


@router.delete("/shopping/{item_id}")
def delete_item(
    item_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _fetch_item(db, item_id)  # 404 if missing
    db.execute("DELETE FROM shopping_items WHERE id = ?", (item_id,))
    db.commit()
    return {"ok": True}


@router.post("/shopping/clear")
def clear_items(
    checked_only: bool = True,
    list_id: int | None = None,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """Clear items — scoped to one list when list_id is given, else all."""
    where = "checked = 1" if checked_only else "1 = 1"
    params: list = []
    if list_id is not None:
        where += " AND COALESCE(list_id, ?) = ?"
        params = [_default_list_id(db), list_id]
    db.execute(f"DELETE FROM shopping_items WHERE {where}", params)
    db.commit()
    return {"ok": True}


# --- Shopping lists (multiple named lists, migration 009) ------------------------

@router.get("/shopping-lists")
def list_shopping_lists(
    db: sqlite3.Connection = Depends(get_db), user=Depends(get_current_user)
):
    default = _default_list_id(db)
    counts = {
        r["lid"]: (r["total"], r["unchecked"])
        for r in db.execute(
            "SELECT COALESCE(list_id, ?) AS lid, COUNT(*) AS total,"
            " SUM(checked = 0) AS unchecked FROM shopping_items GROUP BY lid",
            (default,),
        )
    }
    rows = db.execute(
        "SELECT * FROM shopping_lists ORDER BY is_default DESC, name"
    ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "is_default": bool(r["is_default"]),
            "item_count": counts.get(r["id"], (0, 0))[0],
            "unchecked_count": counts.get(r["id"], (0, 0))[1] or 0,
        }
        for r in rows
    ]


@router.post("/shopping-lists", status_code=201)
def create_shopping_list(
    body: ShoppingListIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        cur = db.execute(
            "INSERT INTO shopping_lists (name) VALUES (?)", (body.name.strip(),)
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="A list with that name exists")
    db.commit()
    row = db.execute(
        "SELECT * FROM shopping_lists WHERE id = ?", (cur.lastrowid,)
    ).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "is_default": bool(row["is_default"]),
        "item_count": 0,
        "unchecked_count": 0,
    }


@router.patch("/shopping-lists/{list_id}")
def rename_shopping_list(
    list_id: int,
    body: ShoppingListIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = db.execute(
        "SELECT * FROM shopping_lists WHERE id = ?", (list_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="List not found")
    try:
        db.execute(
            "UPDATE shopping_lists SET name = ? WHERE id = ?",
            (body.name.strip(), list_id),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="A list with that name exists")
    db.commit()
    return {"ok": True}


@router.delete("/shopping-lists/{list_id}")
def delete_shopping_list(
    list_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = db.execute(
        "SELECT * FROM shopping_lists WHERE id = ?", (list_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="List not found")
    if row["is_default"]:
        raise HTTPException(status_code=400, detail="The default list can't be deleted")
    # Items are moved to the default list, never lost (settled behaviour).
    default = _default_list_id(db)
    db.execute(
        "UPDATE shopping_items SET list_id = ? WHERE COALESCE(list_id, ?) = ?",
        (default, default, list_id),
    )
    db.execute("DELETE FROM shopping_lists WHERE id = ?", (list_id,))
    db.commit()
    return {"ok": True}


# --- Stores & walking routes (§3.5) -----------------------------------------------

def _store(db: sqlite3.Connection, store_id: int) -> dict:
    row = db.execute("SELECT * FROM stores WHERE id = ?", (store_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Store not found")
    order = [
        r["category_id"]
        for r in db.execute(
            "SELECT category_id FROM store_category_order"
            " WHERE store_id = ? ORDER BY position",
            (store_id,),
        )
    ]
    return {"id": row["id"], "name": row["name"], "category_order": order}


def _write_order(db: sqlite3.Connection, store_id: int, order: list[int]) -> None:
    """Replace a store's walking route. Categories missing from the given
    order are appended at the end (new categories default to the end, §3.5)."""
    all_ids = [r["id"] for r in db.execute("SELECT id FROM categories ORDER BY id")]
    seen = [cid for cid in order if cid in all_ids]
    full = seen + [cid for cid in all_ids if cid not in seen]
    db.execute("DELETE FROM store_category_order WHERE store_id = ?", (store_id,))
    db.executemany(
        "INSERT INTO store_category_order (store_id, category_id, position)"
        " VALUES (?, ?, ?)",
        [(store_id, cid, pos) for pos, cid in enumerate(full)],
    )


@router.get("/stores")
def list_stores(db: sqlite3.Connection = Depends(get_db), user=Depends(get_current_user)):
    ids = [r["id"] for r in db.execute("SELECT id FROM stores ORDER BY name")]
    return [_store(db, sid) for sid in ids]


@router.post("/stores", status_code=201)
def create_store(
    body: StoreIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    try:
        cur = db.execute("INSERT INTO stores (name) VALUES (?)", (body.name.strip(),))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="A store with that name exists")
    _write_order(db, cur.lastrowid, body.category_order or [])
    db.commit()
    return _store(db, cur.lastrowid)


@router.put("/stores/{store_id}")
def update_store(
    store_id: int,
    body: StoreIn,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _store(db, store_id)  # 404 if missing
    db.execute("UPDATE stores SET name = ? WHERE id = ?", (body.name.strip(), store_id))
    if body.category_order is not None:
        _write_order(db, store_id, body.category_order)
    db.commit()
    return _store(db, store_id)


@router.delete("/stores/{store_id}")
def delete_store(
    store_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    _store(db, store_id)
    db.execute("DELETE FROM stores WHERE id = ?", (store_id,))
    db.commit()
    return {"ok": True}
