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

import base64
import json
import logging
import mimetypes
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import ai, config, db

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

    # A handler that created/updated a recipe reports its id in the result;
    # record the link (jobs.recipe_id, migration 007) so the inbox can track
    # the draft through to publication. COALESCE keeps a link set at enqueue
    # time (redraft of an existing recipe).
    linked_recipe = result.get("recipe_id") if isinstance(result, dict) else None
    conn.execute(
        "UPDATE jobs SET status = 'done', result = ?, error = NULL,"
        " attempts = ?, recipe_id = COALESCE(recipe_id, ?),"
        " updated_at = datetime('now') WHERE id = ?",
        (json.dumps(result), job["attempts"] + 1, linked_recipe, job["id"]),
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


RECIPE_JSON_SPEC = """\
Reply with ONLY a JSON object in exactly this shape:
{"title": str, "description": str, "servings": int or null,
 "ingredients": [{"amount": number or null, "unit": str or null,
                  "name": str, "note": str or null, "section": str or null}],
 "steps": [str], "tags": [str]}

Rules for ingredients: "name" must contain ONLY the bare purchasable item —
what you'd write on a shopping list. Preparation ("finely diced"), size
("small", "large"), and qualifiers ("optional", "divided") go in "note".
If a line offers an alternative ("25g peeled galangal or ginger, chopped"),
never drop it: the primary item goes in "name" and the alternative is kept
in "note" (e.g. note "peeled, chopped; or ginger").
Keep amounts as plain numbers (no fractions like "1/2" — use 0.5). If the
recipe groups ingredients under headings (e.g. "For the sauce", "For the
topping"), put that heading in "section" for every ingredient in that group
and null for ingredients with no heading — never invent headings that
aren't in the source.

Rules for tags: keep every tag already on the recipe unless it's flatly
wrong for the dish. You may add tags the source clearly supports. Before
adding or renaming a tag, check it against EXISTING TAGS IN USE below — if
an equivalent already exists (e.g. "Asian Food" when "Asian" exists,
"pudding" when "dessert" exists), reuse the existing tag instead of adding a
near-duplicate."""

REDRAFT_PROMPT = """\
Here is the readable text of a recipe web page{draft_clause}.
Extract the recipe, correcting any mistakes in the draft against the page.

{spec}

--- EXISTING TAGS IN USE ---
{existing_tags}

--- PAGE TEXT ---
{page_text}
{draft_section}"""


def _existing_tags(conn):
    """Every tag currently in use, for the dedup rule in RECIPE_JSON_SPEC
    (issue #3: reuse "Asian" instead of inventing "Asian Food")."""
    return [
        r["tag"] for r in conn.execute(
            "SELECT DISTINCT json_each.value AS tag FROM recipes, json_each(recipes.tags)"
            " ORDER BY tag COLLATE NOCASE"
        )
    ]


def _coerce_recipe(data):
    """Validate/repair the model's recipe JSON into editor-ready shape
    (spec §5.3: parse defensively, tolerate nulls). Raises ValueError only
    when there is no usable recipe at all — a failed attempt should retry."""
    if not isinstance(data, dict):
        raise ValueError("model reply was not a JSON object")

    def text(v):
        return str(v).strip() if v is not None and not isinstance(v, (list, dict)) else ""

    title = text(data.get("title"))
    if not title:
        raise ValueError("model reply has no recipe title")

    servings = data.get("servings")
    try:
        servings = max(1, int(servings)) if servings is not None else None
    except (TypeError, ValueError):
        servings = None

    ingredients = []
    for raw in data.get("ingredients") or []:
        if isinstance(raw, str):
            raw = {"name": raw}
        if not isinstance(raw, dict) or not text(raw.get("name")):
            continue
        amount = raw.get("amount")
        try:
            amount = round(float(amount), 2) if amount is not None else None
        except (TypeError, ValueError):
            amount = None
        ingredients.append({
            "amount": amount,
            "unit": text(raw.get("unit")) or None,
            "name": text(raw.get("name")),
            "note": text(raw.get("note")) or None,
            "category_id": None,
            "scalable": True,
            "section": text(raw.get("section")) or None,
        })

    steps = [text(s) for s in data.get("steps") or [] if text(s)]

    tags = []
    for raw in data.get("tags") or []:
        t = text(raw)
        if t and t not in tags:
            tags.append(t)

    return {
        "title": title,
        "description": text(data.get("description")),
        "servings": servings,
        "ingredients": ingredients,
        "steps": steps,
        "tags": tags,
    }


@handles("url_redraft")
def _url_redraft_job(conn, profile, payload):
    """URL import redraft / AI extraction fallback (spec §5.5).

    Two modes share this handler:
    - redraft: payload has recipe_id — page text and the *current saved
      draft* are read from the DB at run time, and the model corrects the
      draft against the page.
    - fallback extraction: payload has page_text and no recipe_id — the
      model extracts a recipe from the page text alone.
    The result JSON is a revised draft the inbox offers for review; nothing
    is applied to any recipe automatically.
    """
    recipe_id = payload.get("recipe_id")
    draft = None
    if recipe_id is not None:
        row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
        if row is None:
            raise ValueError(f"recipe {recipe_id} no longer exists")
        page_text = row["source_page_text"] or ""
        draft = {
            "title": row["title"],
            "description": row["description"],
            "servings": row["servings"],
            "tags": json.loads(row["tags"] or "[]"),
            "ingredients": [
                {"amount": r["amount"], "unit": r["unit"], "name": r["name"], "note": r["note"], "section": r["section"]}
                for r in conn.execute(
                    "SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY position",
                    (recipe_id,),
                )
            ],
            "steps": [
                r["text"]
                for r in conn.execute(
                    "SELECT text FROM steps WHERE recipe_id = ? ORDER BY position",
                    (recipe_id,),
                )
            ],
        }
    else:
        page_text = payload.get("page_text", "")
    if not page_text.strip():
        raise ValueError("no stored page text to work from")

    existing_tags = _existing_tags(conn)

    prompt = REDRAFT_PROMPT.format(
        draft_clause=(
            " and a possibly-flawed structured draft extracted from it" if draft else ""
        ),
        spec=RECIPE_JSON_SPEC,
        existing_tags=", ".join(existing_tags) if existing_tags else "(none yet)",
        page_text=page_text,
        draft_section=(
            "\n--- CURRENT DRAFT (correct this) ---\n" + json.dumps(draft)
            if draft else ""
        ),
    )
    reply = ai.chat(profile, [{"role": "user", "content": prompt}], temperature=0)
    recipe = _coerce_recipe(_extract_json(reply))
    result = {
        "recipe": recipe,
        "recipe_id": recipe_id,
        "url": payload.get("url"),
        "ingredients": len(recipe["ingredients"]),
        "steps": len(recipe["steps"]),
    }
    if recipe_id is None:
        # Fallback extraction creates a brand-new draft: carry the page text
        # into the result so the saved draft can be redrafted later too, and
        # any photo candidates found on the page (issue #2).
        result["page_text"] = page_text
        result["image_urls"] = payload.get("image_urls") or []
    return result


# Stage 1 of the photo import: pure transcription, one photo per call.
# Deliberately minimal — this exact wording was owner-tested against
# qwen3-vl in LM Studio chat and produced word-for-word output, where a
# combined "transcribe AND emit structured JSON" prompt made small vision
# models hallucinate the dish from memory instead of reading the page.
TRANSCRIBE_PROMPT = """\
The attached image is a photo of a page from a cookbook or magazine.
Transcribe only what is visibly printed on the page — do not infer or
complete missing information. Keep the original wording, amounts, and
order exactly as printed."""

# Stage 2: text-only restructuring of the stage-1 transcription. No images
# in this call, so the model can't "re-read" (i.e. re-imagine) the page.
STRUCTURE_PROMPT = """\
Below is a word-for-word transcription of one recipe photographed from a
cookbook or magazine (multiple photos are pages of the same recipe, in
order, separated by "--- PAGE N ---").

This is a FORMATTING task, not a cooking task: convert the transcription
into structured JSON, copying the ingredient list and the method steps
exactly as transcribed — same ingredients, same amounts, same order, same
wording of the instructions. Do not add, substitute, or omit ingredients
or steps; do not "improve" the recipe. If a detail is missing from the
transcription, leave that field null — never fill gaps with a typical
version of the dish.

"ingredients" must come ONLY from the transcription's ingredient list —
the short lines, usually with amounts, sometimes grouped under headings
like "For the sauce:". Emit exactly one JSON ingredient per ingredient
line, in the order the lines are printed — none skipped, none merged, none
reordered. NEVER create an ingredient from a method/instruction sentence:
a quantity that appears only inside an instruction ("cut into 2.5cm-wide
strips", "add 1 teaspoon salt") belongs in that step's text, not in
"ingredients". If an ingredient used in the method has no line in the
ingredient list, the transcription is simply missing it — leave it out
rather than reconstructing it.

{spec}

--- EXISTING TAGS IN USE ---
{existing_tags}

--- TRANSCRIPTION ---
{transcription}"""


@handles("photo_import")
def _photo_import_job(conn, profile, payload):
    """AI photo import (spec §5.3): send the uploaded photos to the vision
    model, parse its structured JSON defensively, and create a *draft*
    recipe — never published; a human reviews it against the original photos
    in the editor (via the inbox's "Review draft"). Ingredient names run
    through the normal categorisation flow (§3.6)."""
    # Deferred import: ingredients.py imports this module for wake().
    from .ingredients import enqueue_categorise_job, resolve_category

    photo_paths = payload.get("photos") or []
    if not photo_paths:
        raise ValueError("photo import job has no photos")

    # Two-stage pipeline: small vision models transcribe accurately but
    # hallucinate when asked to transcribe AND emit structured JSON in one
    # shot. Stage 1 sends each photo alone with a bare transcription prompt
    # (one page per call also keeps the vision-token count well inside the
    # endpoint's context window); stage 2 structures the combined text.
    # Images ride along inline as data URLs (OpenAI-compatible vision form) —
    # LM Studio and OpenRouter both accept this; no URL needs to be public.
    pages = []
    for number, rel in enumerate(photo_paths, start=1):
        path = Path(config.UPLOADS_PATH) / rel
        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        content = [
            {"type": "text", "text": TRANSCRIBE_PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
        ]
        # temperature=0: transcription must copy the page, not riff on it.
        reply = ai.chat(profile, [{"role": "user", "content": content}], temperature=0)
        pages.append(f"--- PAGE {number} ---\n{reply.strip()}")
    transcription = "\n\n".join(pages)

    reply = ai.chat(
        profile,
        [{"role": "user", "content": STRUCTURE_PROMPT.format(
            spec=RECIPE_JSON_SPEC,
            existing_tags=", ".join(_existing_tags(conn)) or "(none yet)",
            transcription=transcription,
        )}],
        temperature=0,
    )
    recipe = _coerce_recipe(_extract_json(reply))

    # Create the draft recipe directly (spec §5.3) — the review screen edits
    # this row, so re-running "Review draft" never duplicates anything.
    cur = conn.execute(
        "INSERT INTO recipes (title, description, servings, tags, status, created_by)"
        " VALUES (?, ?, ?, ?, 'draft', ?)",
        (recipe["title"], recipe["description"], recipe["servings"],
         json.dumps(recipe["tags"]), payload.get("user_id")),
    )
    recipe_id = cur.lastrowid
    conn.execute(
        "UPDATE recipes SET version_group = ? WHERE id = ?", (recipe_id, recipe_id)
    )
    needs_ai = []
    for pos, ing in enumerate(recipe["ingredients"]):
        category_id, miss = resolve_category(conn, ing["name"], None)
        if miss:
            needs_ai.append(ing["name"])
        conn.execute(
            "INSERT INTO ingredients"
            " (recipe_id, position, amount, unit, name, note, category_id, scalable, section)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
            (recipe_id, pos, ing["amount"], ing["unit"], ing["name"],
             ing["note"], category_id, ing["section"]),
        )
    for pos, text in enumerate(recipe["steps"]):
        conn.execute(
            "INSERT INTO steps (recipe_id, position, text) VALUES (?, ?, ?)",
            (recipe_id, pos, text),
        )
    enqueue_categorise_job(conn, needs_ai)

    # Provenance note (issue #4), attributed to whoever queued the import.
    if payload.get("user_id") is not None:
        conn.execute(
            "INSERT INTO recipe_notes (recipe_id, user_id, text) VALUES (?, ?, ?)",
            (recipe_id, payload["user_id"],
             f"Imported by AI from {len(photo_paths)} photo(s)"),
        )
    conn.commit()
    log.info(
        "Photo import job created draft recipe %d (%d ingredients, %d steps)",
        recipe_id, len(recipe["ingredients"]), len(recipe["steps"]),
    )
    # photos ride along so the review screen can show the originals
    # alongside the draft (spec §5.3); the stage-1 transcription is kept so
    # a bad draft can be diagnosed (did the model misread the page, or
    # mangle the restructuring?) without re-running the job.
    return {
        "recipe_id": recipe_id,
        "title": recipe["title"],
        "photos": photo_paths,
        "transcription": transcription,
        "ingredients": len(recipe["ingredients"]),
        "steps": len(recipe["steps"]),
    }


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
