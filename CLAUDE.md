# Scran — guidance for AI agents

Household recipe manager + shopping list, self-hosted in a single Docker
container. The full spec is `recipe-app-spec.md` — read the relevant section
before building a feature, and respect §8 "Settled decisions (do not relitigate)".

**Built so far**: auth + sessions, recipe CRUD/browse/detail/editor with FTS5
search, cooking notes, photo upload, recipe versions ("save as version",
migration 002), shopping list (copy-from-recipe, store-ordered grouping),
stores/categories, and the Settings screens (AI profiles, stores route
editor, categories, users, auth info), and website URL import
(`backend/app/importer.py`, JSON-LD + microdata). AI slice stages 1–2 are
done and owner-tested: shared AI client (`backend/app/ai.py`), profile
test-connection, job queue worker (`backend/app/worker.py`), jobs API
(`backend/app/jobs.py`), and the import inbox screen
(`frontend/src/pages/InboxPage.jsx`), plus the stage-3 categorise job
handler (built, awaiting owner testing). **Remaining**: AI slice stages 3.5–5
(url_redraft job + `source_page_text` migration, photo
import + review screen, name/note cleanup job — staged plan is in the
conversation that built stages 1–2; spec §5 has the details), PWA service
worker.

## AI slice — state after stage 2 (read before building stage 3)

- **Build stages one at a time and STOP after each** so the owner can test:
  stage 3 (categorise) is done, next is 3.5 (url_redraft + AI-extraction
  fallback for schema.org-less pages), 4 (photo import + review screen),
  5 (cleanup job + remove the temporary "Enqueue test job" button in
  `InboxPage.jsx` and `POST /api/jobs/test` in `jobs.py`).
- `backend/app/ai.py` is the **only** place that talks to AI endpoints.
  Stdlib urllib only (no httpx/requests — deliberate). `chat()` accepts the
  multimodal content-list form for vision. Log summaries only, never
  payloads or keys.
- Worker: single daemon thread (started in `main.py` lifespan). Register
  job handlers in `worker.py` with `@handles("<type>")` — pending jobs
  whose type has no handler are silently left alone (that's why pre-stage-3
  `categorise` jobs sit harmlessly in the queue). Handler signature:
  `fn(conn, profile, payload_dict) -> result dict`; raise to trigger
  retry/backoff (3 attempts: 60s, 120s). Call `worker.wake()` after
  enqueueing from any endpoint so the job runs immediately.
- Endpoint-down behaviour: worker probes (`ai.probe`, GET /models, 5s
  timeout) before running jobs; unreachable → jobs stay pending, re-poll
  every 120s. `GET /api/ai-status` serves the worker's *cached* probe (≤60s
  old) so the inbox loads instantly — don't make it probe live.
- Jobs table CHECK now allows photo_import|categorise|url_redraft|
  name_note_cleanup|test (migration 004 rebuilt the table). `GET /api/jobs`
  returns a per-type `summary` string, not raw payloads — extend `_job()`
  in `jobs.py` when adding a type. UI maps DB statuses pending/running/
  done/failed to Queued/Processing/Done/Failed in `InboxPage.jsx`
  (`STATUS_META`); photo_import 'done' should display as "needs review".
- Astryx gotcha: `StatusDot` takes `variant` (success|error|…) + required
  `label`, not `status`. Design mockups live in the Claude Design project
  (DesignSync tool), not on disk — `ui_kits/recipe-app/import-inbox.html`
  was the template for InboxPage.
- Stage 3 (built, untested by owner): `_categorise_job` in `worker.py` asks
  the model for a name→category JSON mapping (`_extract_json` strips fences),
  falls back to "other" for unknown categories, and writes back to
  `ingredient_lookup` + still-NULL `ingredients`/`shopping_items` rows only —
  manual overrides made while queued always win (backfilled from lookup, no
  AI call). `enqueue_categorise_job()` now calls `worker.wake()`.
- Testing gotcha: `pkill -f <pattern>` from the Bash tool matches its own
  wrapper shell and kills it (exit 144) — use a bracket pattern like
  `pkill -f "fake_a[i].py"`. A fake OpenAI-compatible server for tests is
  at scratchpad `fake_ai.py` (port 8021; port 8020 is taken by an unknown
  long-lived process).

## Owner context

The maintainer is an IT infrastructure engineer learning React with this
project. Prefer boring, well-documented technology; write clear, idiomatic,
well-commented code (function components + hooks, no exotic patterns).

## Stack

- **Backend** (`backend/`): Python 3.13, FastAPI, plain `sqlite3` (no ORM),
  WAL mode, FTS5 for search. Keep the dependency count low.
- **Frontend** (`frontend/`): Vite + React (JSX, not TS) using the **Astryx
  design system** (`@astryxdesign/core`, pre-built stylesheet path — no StyleX
  build plugin). Component rules live in `frontend/.claude/CLAUDE.md`;
  use `cd frontend && npx astryx build/component/template` before writing UI.
  Gotchas: the theme provider export is `Theme`, not `XDSTheme`; `Tab` and
  `TabList` are exported from `@astryxdesign/core/TabList` (there is no
  `/Tabs` subpath).
- **Design source of truth**: Claude Design project "Recipe App"
  (id `b5f5ec45-0fc4-4633-8481-6b81a6d56147`, via the DesignSync tool /
  claude_design MCP). Screen mockups are under `ui_kits/recipe-app/` —
  consult the mockup before building each screen. The Astryx MCP server
  (`xds`) is registered in `.mcp.json` for component docs.

## Conventions

- **Migrations**: numbered `backend/app/migrations/NNN_name.sql`, applied
  automatically at startup by `app/db.py`. Never edit an applied migration;
  add a new file.
- **Auth**: isolated in `backend/app/auth/`. Nothing outside that package
  touches cookies, password hashes, or the trusted-proxy header. Endpoints
  take `user=Depends(get_current_user)` (or `get_current_admin`).
- **API**: JSON under `/api/...`; the SPA is served by FastAPI in production
  and by Vite (proxying `/api` to :8000) in development.
- **Ingredients**: every save goes through the categorisation flow in
  `backend/app/ingredients.py` (lookup table first, AI job queue on miss).
  Manual recategorisation anywhere must write back to `ingredient_lookup`.
- **SQLite connections**: always open via `app/db.py` `connect()` — it sets
  WAL, foreign keys, and `check_same_thread=False` (FastAPI's threadpool may
  run an endpoint on a different thread than the one that opened the
  connection; omitting it causes intermittent 500s).
- **AI profile API keys** stay server-side: API responses expose `has_key`
  only, and a blank key on update means "keep the stored key".
- Shopping list items are copies with a `recipe_id` tag, never live links.
- AI-imported recipes are always `draft` until a human publishes.
- Frontend styling: Astryx components first; for layout containers use inline
  styles with Astryx tokens (`var(--spacing-*)`, `var(--color-*)`) — no
  hard-coded colours/px, no CSS frameworks. Shared style fragments live in
  `frontend/src/styles.js`.

## Dev commands

```bash
# backend (terminal 1)
cd backend && SCRAN_ADMIN_USERNAME=admin SCRAN_ADMIN_PASSWORD=changeme \
  .venv/bin/uvicorn app.main:app --reload --port 8000

# frontend (terminal 2)
cd frontend && npm run dev            # http://localhost:5173

cd frontend && npm run build          # production build (also type-checks JSX)
docker compose up -d --build          # full container at :8000
```

Dev data lands in `backend/data/` (gitignored). Uploads are served at
`/api/uploads/<path>` (login required).

## Verifying changes

**`backend/data/` is the owner's live dev database — never wipe it, inject
test rows into it, or occupy port 8000 for testing.** Run tests against an
isolated instance instead:

```bash
cd backend && SCRAN_DB_PATH=/tmp/scran-test.db SCRAN_UPLOADS_PATH=/tmp/scran-test-uploads \
  SCRAN_ADMIN_USERNAME=admin SCRAN_ADMIN_PASSWORD=changeme12 \
  .venv/bin/uvicorn app.main:app --port 8010
```

Build the frontend (`npm run build` — the test server serves `frontend/dist`),
then drive the real app with `puppeteer-core` (devDependency) and the system
Chromium at `/usr/bin/chromium`. Screenshot at 390×844 (mobile-first) and
check desktop ≥1024px too. Test-script quirks: Astryx `Tab` buttons duplicate
their label in `textContent` ("StoresStores"), uppercase section headers are
CSS `text-transform` (so `innerText` returns uppercase), and `textarea`
values don't appear in `innerText`.
