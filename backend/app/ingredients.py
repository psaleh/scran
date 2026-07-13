"""Ingredient lookup table: autocomplete + the categorisation flow (spec §3.2, §3.6).

The lookup table maps a normalised ingredient name to a grocery category and
carries a use_count that powers autocomplete ranking. It is always consulted
before any AI call; the AI categorisation job only runs for genuine misses.
"""

import json
import sqlite3

from fastapi import APIRouter, Depends, Query

from . import worker
from .auth.deps import get_current_user
from .db import get_db

router = APIRouter(prefix="/api", tags=["ingredients"])


def normalise(name: str) -> str:
    """Canonical form used for lookup matching: trimmed, lowercased."""
    return name.strip().lower()


def resolve_category(
    db: sqlite3.Connection, name: str, category_id: int | None
) -> tuple[int | None, bool]:
    """Categorisation flow for one ingredient name being saved.

    Returns (category_id, needs_ai):
    - If the user picked a category explicitly, that wins AND is written back
      to the lookup table so it sticks for the future (manual override, §3.6.4).
    - Otherwise a lookup hit supplies the category.
    - A miss returns (None, True) — caller should enqueue an AI job.
    Every path increments use_count for autocomplete ranking.
    """
    key = normalise(name)
    if not key:
        return None, False

    row = db.execute(
        "SELECT category_id FROM ingredient_lookup WHERE ingredient_name = ?", (key,)
    ).fetchone()

    if category_id is not None:
        # Manual choice: upsert and remember it.
        db.execute(
            "INSERT INTO ingredient_lookup (ingredient_name, category_id, use_count)"
            " VALUES (?, ?, 1)"
            " ON CONFLICT(ingredient_name)"
            " DO UPDATE SET category_id = excluded.category_id, use_count = use_count + 1",
            (key, category_id),
        )
        return category_id, False

    if row is not None:
        db.execute(
            "UPDATE ingredient_lookup SET use_count = use_count + 1"
            " WHERE ingredient_name = ?",
            (key,),
        )
        return row["category_id"], row["category_id"] is None

    # Genuine miss: remember the name (uncategorised) and ask for AI help.
    db.execute(
        "INSERT INTO ingredient_lookup (ingredient_name, category_id, use_count)"
        " VALUES (?, NULL, 1)",
        (key,),
    )
    return None, True


def enqueue_categorise_job(db: sqlite3.Connection, names: list[str]) -> None:
    """Queue one batched AI categorisation job for unknown names (spec §5.4).

    If no AI endpoint is configured or reachable the job just waits in
    'pending', which is exactly the graceful-degradation behaviour §7 asks for.
    """
    unique = sorted({normalise(n) for n in names if normalise(n)})
    if not unique:
        return
    db.execute(
        "INSERT INTO jobs (type, payload) VALUES ('categorise', ?)",
        (json.dumps({"names": unique}),),
    )
    # Nudge the worker so the job runs immediately. The caller commits just
    # after this; worst case the worker's first look misses the row and the
    # next 15s poll picks it up.
    worker.wake()


@router.get("/ingredients/suggest")
def suggest(
    q: str = Query(min_length=2),
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """Autocomplete: starts-with matches first, then contains matches,
    each group ordered by use_count (spec §3.2)."""
    key = normalise(q)
    like_escaped = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = db.execute(
        "SELECT ingredient_name, category_id, use_count,"
        "       (ingredient_name LIKE ? ESCAPE '\\') AS starts"
        " FROM ingredient_lookup"
        " WHERE ingredient_name LIKE ? ESCAPE '\\'"
        " ORDER BY starts DESC, use_count DESC, ingredient_name"
        " LIMIT 8",
        (like_escaped + "%", "%" + like_escaped + "%"),
    ).fetchall()
    return [
        {
            "name": r["ingredient_name"],
            "category_id": r["category_id"],
        }
        for r in rows
    ]


@router.get("/categories")
def list_categories(
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    return [
        {"id": r["id"], "name": r["name"]}
        for r in db.execute("SELECT id, name FROM categories ORDER BY name")
    ]
