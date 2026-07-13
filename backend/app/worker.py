"""Background job worker (spec §5.2).

A single daemon thread polls the jobs table for pending work. Before picking
anything up it probes the active AI endpoint with a short timeout — if the
owner's PC is off, jobs simply stay pending and we re-check on the next poll.
Failed jobs retry with exponential backoff up to MAX_ATTEMPTS, then stay
'failed' until a manual retry from the import inbox.

Job handlers are registered with the @handles decorator. A pending job whose
type has no registered handler yet is left alone (it waits for a future
version of the app that can run it), which is also why old queued
'categorise' jobs are harmless until stage 3 lands.

The app stays fully usable if this thread is never started or the endpoint
never appears (spec §7): everything here is fire-and-forget from the UI's
point of view.
"""

import json
import logging
import threading
import time
from datetime import datetime, timezone

from . import ai, db

log = logging.getLogger("scran.worker")

POLL_SECONDS = 15               # normal cadence between queue checks
UNREACHABLE_POLL_SECONDS = 120  # spec §5.2: retry every 2–5 min when endpoint is down
PROBE_CACHE_SECONDS = 60        # how stale the /api/ai-status probe result may get
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 60       # retry delays: 60s, 120s after failures 1 and 2

_handlers = {}

# Wakes the worker immediately when a job is enqueued or retried, instead of
# waiting out the current sleep.
_wake = threading.Event()
_stop = threading.Event()
_thread = None

# Last endpoint probe result, shown in the import inbox status indicator.
# Guarded by _status_lock; read via ai_status().
_status_lock = threading.Lock()
_status = {"profile_name": None, "reachable": None, "checked_at": None,
           "_checked_monotonic": 0.0}


def handles(job_type):
    """Decorator: register a function(conn, payload) -> result dict for a job type."""
    def register(fn):
        _handlers[job_type] = fn
        return fn
    return register


def wake():
    """Nudge the worker to poll now (called after enqueue/retry endpoints)."""
    _wake.set()


def ai_status():
    """Current endpoint status for the UI: active profile + last probe result."""
    with _status_lock:
        return {k: v for k, v in _status.items() if not k.startswith("_")}


def start():
    global _thread
    _stop.clear()
    _thread = threading.Thread(target=_run, name="scran-worker", daemon=True)
    _thread.start()
    log.info("Job worker started")


def stop():
    _stop.set()
    _wake.set()
    if _thread is not None:
        _thread.join(timeout=5)


def _run():
    while not _stop.is_set():
        try:
            delay = _poll_once()
        except Exception:
            # The worker must never die; log and carry on.
            log.exception("Worker poll crashed; continuing")
            delay = POLL_SECONDS
        _wake.wait(timeout=delay)
        _wake.clear()


def _poll_once():
    """One queue check. Returns how long to sleep before the next one."""
    conn = db.connect()
    try:
        profile = ai.get_active_profile(conn)
        jobs = _due_jobs(conn)

        # Refresh the status indicator: probe if there's work waiting or the
        # cached result is getting old. Skipping the probe when idle+fresh
        # keeps us from hammering a switched-off PC with connection attempts.
        with _status_lock:
            stale = time.time() - _status["_checked_monotonic"] > PROBE_CACHE_SECONDS
        if profile is None:
            _set_status(None, None)
            return POLL_SECONDS
        if jobs or stale:
            reachable = ai.probe(profile)
            _set_status(profile["name"], reachable)
        else:
            reachable = ai_status()["reachable"]

        if not jobs:
            return POLL_SECONDS
        if not reachable:
            log.info(
                "%d job(s) pending but endpoint %r unreachable; retrying in %ds",
                len(jobs), profile["name"], UNREACHABLE_POLL_SECONDS,
            )
            return UNREACHABLE_POLL_SECONDS

        for job in jobs:
            if _stop.is_set():
                break
            _run_job(conn, profile, job)
        return POLL_SECONDS
    finally:
        conn.close()


def _set_status(profile_name, reachable):
    with _status_lock:
        _status.update(
            profile_name=profile_name,
            reachable=reachable,
            checked_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            _checked_monotonic=time.time(),
        )


def _due_jobs(conn):
    """Pending jobs whose backoff delay (if any) has elapsed, oldest first.

    Backoff piggybacks on updated_at: a job that failed attempt N waits
    BACKOFF_BASE_SECONDS * 2^(N-1) from that failure before it's due again.
    """
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status = 'pending' AND attempts < ?"
        " AND (attempts = 0"
        "      OR datetime(updated_at, '+' || (? * (1 << (attempts - 1))) || ' seconds')"
        "         <= datetime('now'))"
        " ORDER BY id",
        (MAX_ATTEMPTS, BACKOFF_BASE_SECONDS),
    ).fetchall()
    return [row for row in rows if row["type"] in _handlers]


def _run_job(conn, profile, job):
    conn.execute(
        "UPDATE jobs SET status = 'running', updated_at = datetime('now')"
        " WHERE id = ?",
        (job["id"],),
    )
    conn.commit()
    log.info("Job %d (%s) starting, attempt %d", job["id"], job["type"], job["attempts"] + 1)

    try:
        payload = json.loads(job["payload"])
        result = _handlers[job["type"]](conn, profile, payload)
    except Exception as exc:
        attempts = job["attempts"] + 1
        # Give up permanently after MAX_ATTEMPTS; otherwise back to pending
        # and the backoff in _due_jobs delays the next go.
        status = "failed" if attempts >= MAX_ATTEMPTS else "pending"
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, attempts = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (status, str(exc)[:1000], attempts, job["id"]),
        )
        conn.commit()
        log.warning(
            "Job %d (%s) attempt %d failed (%s): %s",
            job["id"], job["type"], attempts,
            "giving up" if status == "failed" else "will retry", exc,
        )
        return

    conn.execute(
        "UPDATE jobs SET status = 'done', result = ?, error = NULL,"
        " attempts = ?, updated_at = datetime('now') WHERE id = ?",
        (json.dumps(result), job["attempts"] + 1, job["id"]),
    )
    conn.commit()
    log.info("Job %d (%s) done", job["id"], job["type"])


# --- Handlers ----------------------------------------------------------------

def _extract_json(text):
    """Pull a JSON object out of a model reply, tolerating markdown fences
    and surrounding chatter (spec §5.3: parse defensively)."""
    text = text.strip()
    if text.startswith("```"):
        # Drop the opening fence line (``` or ```json) and the closing fence.
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    # Fall back to the outermost {...} span if there's still prose around it.
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("no JSON object in model reply")
        text = text[start:end + 1]
    return json.loads(text)


def _apply_category(conn, name, category_id):
    """Fill in the category on any still-uncategorised ingredient and
    shopping-list rows matching a normalised name. Never overwrites."""
    conn.execute(
        "UPDATE ingredients SET category_id = ?"
        " WHERE category_id IS NULL AND lower(trim(name)) = ?",
        (category_id, name),
    )
    conn.execute(
        "UPDATE shopping_items SET category_id = ?"
        " WHERE category_id IS NULL AND lower(trim(name)) = ?",
        (category_id, name),
    )


CATEGORISE_PROMPT = """\
You are categorising grocery shopping items. Assign each ingredient below to
exactly one of these grocery categories:

{categories}

Reply with ONLY a JSON object mapping each ingredient name (exactly as given)
to a category name from the list. Use "{fallback}" if nothing fits well.

Ingredients:
{names}
"""


@handles("categorise")
def _categorise_job(conn, profile, payload):
    """AI categorisation of unknown ingredient names (spec §5.4).

    Asks the model to map each name to one of the household's categories,
    then writes the answers to ingredient_lookup and applies them to any
    still-uncategorised ingredient and shopping-list rows with that name.
    Manual overrides made while the job was queued always win: we only fill
    in rows/lookup entries whose category is still NULL.
    """
    # Names may have been categorised manually since the job was queued:
    # backfill any still-blank rows from the lookup and drop them from the
    # AI request. Only genuinely unknown names go to the model.
    names = []
    for n in payload.get("names", []):
        row = conn.execute(
            "SELECT category_id FROM ingredient_lookup WHERE ingredient_name = ?",
            (n,),
        ).fetchone()
        if row is None or row["category_id"] is None:
            names.append(n)
        else:
            _apply_category(conn, n, row["category_id"])
    if not names:
        conn.commit()
        return {"applied": 0, "message": "All names already categorised"}

    categories = {
        row["name"].lower(): row["id"]
        for row in conn.execute("SELECT id, name FROM categories")
    }
    fallback = "other" if "other" in categories else next(iter(categories))
    prompt = CATEGORISE_PROMPT.format(
        categories="\n".join(f"- {row}" for row in sorted(categories)),
        fallback=fallback,
        names="\n".join(f"- {n}" for n in names),
    )
    reply = ai.chat(profile, [{"role": "user", "content": prompt}], timeout=180)
    mapping = _extract_json(reply)
    if not isinstance(mapping, dict):
        raise ValueError("model reply was not a JSON object")

    applied = {}
    for name in names:
        category = mapping.get(name)
        category_id = categories.get(str(category).strip().lower()) if category else None
        if category_id is None:
            # Unknown/missing category from the model: fall back rather than
            # leaving the name queued forever.
            category_id = categories[fallback]
            category = fallback
        # Only fill blanks — never overwrite a manual choice (spec §3.6.4).
        conn.execute(
            "UPDATE ingredient_lookup SET category_id = ?"
            " WHERE ingredient_name = ? AND category_id IS NULL",
            (category_id, name),
        )
        _apply_category(conn, name, category_id)
        applied[name] = category
    conn.commit()
    return {"applied": len(applied), "categories": applied}


@handles("test")
def _test_job(conn, profile, payload):
    """Trivial round-trip for the temporary dev button (stage 2 verification)."""
    reply = ai.chat(
        profile,
        [{"role": "user", "content": "Reply with a short greeting and today's weekday guess."}],
        max_tokens=100,
        timeout=120,
    )
    return {"reply": reply.strip()[:500]}
