"""Job queue API: the import inbox screen and the AI endpoint status (spec §5.2).

The worker itself lives in worker.py; this module is just the HTTP surface —
listing jobs, manual retry, and the temporary "enqueue test job" dev helper.
"""

import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from . import worker
from .auth.deps import get_current_user
from .db import get_db

router = APIRouter(prefix="/api", tags=["jobs"])


def _job(row: sqlite3.Row, recipe_status: str | None = None) -> dict:
    """Shape a jobs row for the UI. Payloads can be big (page text, photos),
    so expose a small type-specific summary instead of the raw payload."""
    payload = json.loads(row["payload"] or "{}")
    summary = ""
    if row["type"] == "categorise":
        names = payload.get("names", [])
        summary = f"{len(names)} ingredient(s): " + ", ".join(names[:5])
        if len(names) > 5:
            summary += ", …"
    elif row["type"] == "photo_import":
        summary = f"{len(payload.get('photos', []))} photo(s)"
    elif row["type"] in ("url_redraft", "video_import"):
        summary = payload.get("url", "")
    elif row["type"] == "test":
        summary = "Trivial AI round-trip (dev)"
    return {
        "id": row["id"],
        "type": row["type"],
        "status": row["status"],
        "summary": summary,
        "result": json.loads(row["result"]) if row["result"] else None,
        "error": row["error"],
        "attempts": row["attempts"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        # The recipe this job produced/updated, and its current status —
        # lets the inbox show a review job as Done once that recipe is
        # actually published, instead of "needs review" forever.
        "recipe_id": row["recipe_id"],
        "recipe_status": recipe_status,
    }


@router.get("/jobs")
def list_jobs(
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    rows = db.execute(
        "SELECT jobs.*, recipes.status AS recipe_status FROM jobs"
        " LEFT JOIN recipes ON recipes.id = jobs.recipe_id"
        " ORDER BY jobs.id DESC LIMIT 100"
    ).fetchall()
    return [_job(r, recipe_status=r["recipe_status"]) for r in rows]


@router.post("/jobs/{job_id}/retry")
def retry_job(
    job_id: int,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    row = db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if row["status"] != "failed":
        raise HTTPException(status_code=400, detail="Only failed jobs can be retried")
    # Reset attempts so the job gets a full fresh set of retries.
    db.execute(
        "UPDATE jobs SET status = 'pending', attempts = 0, error = NULL,"
        " updated_at = datetime('now') WHERE id = ?",
        (job_id,),
    )
    db.commit()
    worker.wake()
    return _job(db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())


@router.post("/jobs/test", status_code=201)
def enqueue_test_job(
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """TEMPORARY dev helper (stage 2): queue a trivial AI call so the full
    queue → probe → run loop can be verified. Removed in stage 5."""
    cur = db.execute("INSERT INTO jobs (type, payload) VALUES ('test', '{}')")
    db.commit()
    worker.wake()
    return _job(db.execute("SELECT * FROM jobs WHERE id = ?", (cur.lastrowid,)).fetchone())


@router.get("/ai-status")
def ai_status(
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    """Active profile + last endpoint probe result, for the inbox indicator.

    Served from the worker's cached probe (refreshed at most every minute)
    so this endpoint is always instant, even when the endpoint is down.
    """
    status = worker.ai_status()
    if status["profile_name"] is None:
        # Worker may not have polled yet (or no profile configured) — report
        # the configured profile name without claiming reachability.
        from . import ai
        profile = ai.get_active_profile(db)
        status["profile_name"] = profile["name"] if profile else None
    return status
