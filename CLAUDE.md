# Scran — guidance for AI agents

Household recipe manager + shopping list, self-hosted in a single Docker
container. Design phase is complete — this file is now the sole spec and
project record (the standalone spec doc has been folded in and removed).
Respect "Settled decisions (do not relitigate)" below.

**Built so far**: auth + sessions, recipe CRUD/browse/detail/editor with FTS5
search (ingredient sections, manual delete w/ confirm — admin-only, see
below, tag autocomplete against existing DB tags with arrow-key selection),
cooking notes (including server-added provenance notes — see below), photo
upload, recipe versions ("save as version", migration 002), shopping list
(copy-from-recipe, store-ordered grouping, swipe-only complete/remove —
plain tap does nothing), stores/categories, and the Settings screens (AI
profiles, stores route editor, categories, users, auth info), website URL
import (`backend/app/importer.py`, JSON-LD + microdata, plus photo-candidate
scraping — see below), and cross-instance recipe import/export (JSON
paste-or-file, see below). AI slice stages 1–3.5 are done and owner-tested:
shared AI client (`backend/app/ai.py`), profile test-connection, job queue
worker (`backend/app/worker.py`), jobs API (`backend/app/jobs.py`), the
import inbox screen (`frontend/src/pages/InboxPage.jsx`), the categorise job
handler, manual recategorisation UI (shopping-list row dialog + editor
per-row selector), and url_redraft (AI-extraction fallback, "Tidy up with
AI" — available on the very first import review, before any manual save).
Stage 4 (photo import + review screen) is built and verified end-to-end
against a fake AI server, but **not yet owner-tested with real cookbook
photos** — see "AI slice" below for its shape.
YouTube video import is also built (2026-07-14, verified against a fake AI
server, not yet owner-tested): `POST /api/import/video` (`importer.py`)
validates the link and queues a `video_import` job; `_video_import_job` in
`worker.py` makes ONE multimodal call (`video_url` content part +
`response_format: json_object`) to the **dedicated video AI profile**
(`ai_profiles.purpose = 'video'`, migration 008 — video needs a hosted
video-capable model like Gemini via OpenRouter, so it's separate from the
everyday active profile; `activate` refuses video profiles and the Settings
profile dialog has a purpose checkbox). The job creates the draft itself via
`_create_draft_recipe()` (shared with photo_import; sets `source_url` to
the video link, provenance note "Imported by AI from YouTube video").
`_poll_once` probes/runs video jobs separately from the general queue so
they still run when the owner's local-model PC is off. Frontend:
`ImportVideoDialog.jsx` (Browse → "Import from YouTube…"); inbox review
opens the draft recipe directly (no photos column).
**Remaining**: AI slice stage 5 (name/note cleanup job + removing the
temporary test-job button/endpoint — see "AI integration" below), PWA
service worker.

## Recent additions (2026-07-14, not yet folded into narrative above)

- **Recipe import/export** (`ExportRecipeDialog.jsx`, `ImportDataDialog.jsx`):
  a portable JSON shape for moving a single recipe between Scran instances,
  separate from the AI import flows — no review queue, saved as a draft
  immediately. `GET /api/recipes/{id}/export` returns `RecipeExport`
  (`backend/app/recipes.py`): title/description/servings/tags/ingredients
  (with category **name**, not `category_id` — ids aren't portable across
  installs)/steps/photo (base64-embedded so a copy-paste round-trip carries
  the picture). `POST /api/recipes/import` (`RecipeImportIn`) re-matches
  each ingredient's category name against this instance's categories
  (falls back to the normal uncategorised/AI-categorise flow on a miss).
  Both dialogs offer copy-to-clipboard/paste and file download/upload.
  Export is reachable from `RecipeDetailPage.jsx`; import from
  `BrowsePage.jsx`'s add menu.
- **Publish button** on `RecipeDetailPage.jsx`: draft recipes get a
  "Publish" button beside "Edit" that PUTs the recipe with `status:
  'published'` — resends the full recipe body (title/ingredients/steps/etc,
  not just status) since `PUT /api/recipes/{id}` replaces the whole record.
- **Admin-only recipe delete**: `DELETE /api/recipes/{id}` now depends on
  `get_current_admin`, not `get_current_user` — matches the Users/Settings
  admin gating already in place.
- **Logout**: `AppNav.jsx` takes an `onLogout` prop and renders a logout
  control (icon button on desktop nav, bottom-nav item on mobile).
- **Production Docker Compose**: `docker-compose.prod.yml` at repo root
  (separate from the dev `docker-compose.yml`) for deploying the built
  image with the two persistent volumes.
- **Multiple shopping lists** (2026-07-17, migration 009): `shopping_lists`
  table (one `is_default` row, enforced by a partial unique index) +
  nullable `shopping_items.list_id` — **NULL is always read as the default
  list** (ALTER TABLE can't add NOT NULL), hence the `COALESCE`/`or default`
  handling in `shopping.py`. CRUD under `/api/shopping-lists` (409 on dupe
  name, 400 deleting the default; deleting a list moves its items to the
  default — never lost). Recipe sends (`from-recipe`) always land on the
  default list; `POST /api/shopping` and `PATCH /api/shopping/{id}` take an
  optional `list_id` (POST falls back to default on a stale id so undo
  survives list deletion; PATCH moves — never copies — the item);
  `/api/shopping/clear` takes an optional `?list_id=` scope.
  `ShoppingListPage.jsx`: lists render as `TabList` tabs (hidden when only
  one list exists) with unchecked counts; all items are fetched once and
  filtered client-side by `activeListId` (persisted in
  `localStorage['scran.shoppingList']`). Items move via an HTML5-drag ⠿
  handle onto a tab (handle is separate from the row so the pointer-swipe
  gesture is untouched; each Astryx `Tab` takes the drop handlers directly —
  it spreads rest props onto its button) or via a "Move to list" picker in
  the ⊞ row dialog (the touch/assistive path). Manual add and clear are
  scoped to the active tab; undo restores to the item's original list.
  Lists are managed in Settings → Shopping lists (`ShoppingListsSection`,
  clone of CategoriesSection; default shows a Badge, no delete button).

## Post-launch fixes (GitHub issues, 2026-07-13)

Owner filed 8 issues after first real use; all fixed in one pass. Notable
follow-on mechanics future agents should know about:

- **Ingredient sections** (issue #1): nullable `ingredients.section`
  (migration 006). A row's `section` text starts a new heading; blank rows
  inherit whichever heading came before them — both the editor
  (`RecipeEditorPage.jsx`) and detail page compute this the same way when
  rendering, and `buildBody()` fills in the *effective* section (not just
  the literal per-row text) before saving, so every row always carries the
  section it actually belongs to. The URL importer detects headings
  flattened into `recipeIngredient` arrays (`_is_section_heading` in
  `importer.py`, e.g. "For the sauce:") and the AI redraft spec
  (`RECIPE_JSON_SPEC` in `worker.py`) asks for `section` per ingredient too.
- **Scraped photo candidates** (issue #2): `importer.py` extracts candidate
  image URLs (schema.org `image` + `og:image` fallback) into `image_urls` on
  both the direct import and the AI-fallback job result — **nothing is
  downloaded until the user picks one** in the editor's thumbnail row.
  `RecipeIn.photo_url` carries that choice to `POST`/`PUT /api/recipes`,
  which downloads it server-side (`_apply_photo_url` in `recipes.py`, reuses
  `importer.fetch_image`) exactly like a manual upload. A local file upload
  always takes precedence over a picked candidate (mutually exclusive in the
  editor state).
- **Tag dedup on AI tidy-up** (issue #3): the redraft prompt now includes
  the DB's existing tags and instructs the model to reuse a near-duplicate
  ("Asian Food" → "Asian") instead of adding one — `RECIPE_JSON_SPEC` +
  `REDRAFT_PROMPT` in `worker.py`. `_coerce_recipe` now parses/dedupes
  `tags` from the model reply (it silently dropped them before, which is
  why tidy-up used to wipe a recipe's tags).
- **Auto-added notes** (issue #4): `RecipeIn.ai_reviewed` (set by the editor
  only for the one save right after opening an AI-reviewed draft) and a
  `source_url`-on-create both trigger a server-written `recipe_notes` row
  ("Reviewed and tidied up by AI" / "Imported from `<url>`") via
  `_add_system_note` in `recipes.py`. `RecipeDetailPage.jsx` linkifies bare
  URLs inside note text so the import-source note is clickable.
  Photo-scan imports get their provenance note ("Imported by AI from N
  photo(s)") from the worker at draft-creation time, not via `ai_reviewed`.
- **Job ↔ recipe linking** (issue: inbox should show "Done" not
  "needs review" forever): nullable `jobs.recipe_id` (migration 007), set at
  enqueue time for a redraft-of-an-existing-recipe, or via
  `RecipeIn.review_job_id` when a fallback-extraction draft (no recipe yet)
  gets saved for the first time. `GET /api/jobs` left-joins `recipes.status`
  as `recipe_status`; `InboxPage.jsx`'s `needsReview` is now
  `status === 'done' && REVIEW_TYPES.has(type) && recipe_status !== 'published'`.
  `review()` prefers `job.recipe_id` over `job.result.recipe_id` so
  re-clicking "Review draft" after an earlier draft save reopens that
  recipe instead of creating a duplicate.
- Mobile layout: app shell uses `100dvh` not `100vh` (the latter sits under
  mobile browser chrome and pushes the bottom nav off-screen); the browse
  grid is single-column below the desktop breakpoint.

## AI slice — state after stage 3.5 (read before building stage 4)

- **Build stages one at a time and STOP after each** so the owner can test:
  stages 3 (categorise) and 3.5 (url_redraft) are done and owner-tested;
  stage 4 (photo import) is built, awaiting owner testing with real
  cookbook photos. Next is 5 (cleanup job + remove the temporary "Enqueue
  test job" button in `InboxPage.jsx` and `POST /api/jobs/test` in
  `jobs.py`).
- Stage 4 shape: `POST /api/import/photos` (`importer.py`) stores 1–8
  uploaded photos under `uploads/import/` and queues ONE `photo_import` job
  (payload `{photos, user_id}`). `_photo_import_job` in `worker.py` runs a
  **two-stage pipeline** (small vision models hallucinate when asked to
  transcribe AND emit structured JSON in one call — first owner test with
  qwen3-vl-8b produced invented/missing ingredients): stage 1 sends each
  photo alone as a base64 data URL (OpenAI vision content-list form) with
  the bare `TRANSCRIBE_PROMPT` (owner-tested wording — don't embellish);
  stage 2 is a text-only `STRUCTURE_PROMPT` call that converts the combined
  transcription to recipe JSON via `_extract_json` + `_coerce_recipe`, with
  explicit rules: ingredients only from ingredient-list lines in printed
  order (never invented from method sentences — quantities inside an
  instruction stay in the step), and "X or Y" alternatives preserved in
  `note` (rule lives in `RECIPE_JSON_SPEC`, so url_redraft gets it too).
  The transcription is kept in the job result and shown collapsed
  (`Collapsible`) in the editor's review column, so a bad draft can be
  traced to a misread photo vs. a mangled restructuring. Photos upload at
  ORIGINAL resolution deliberately — a 1600px client-side downscale was
  tried and made small-print ingredient columns illegible to the model,
  which silently dropped them (per-photo stage-1 calls keep context
  pressure low without it). Unlike url_redraft, the job creates the draft
  recipe itself
  (ingredients via `resolve_category` +
  `enqueue_categorise_job`, provenance note "Imported by AI from N
  photo(s)", always `draft`). `_run_job` copies `result["recipe_id"]` into
  `jobs.recipe_id` on success, so re-clicking "Review draft" reopens the
  same recipe. Review = the normal editor with router state
  `{reviewPhotos: [paths]}` from `InboxPage.jsx`: originals in a sticky
  left column on desktop / stacked above the form on mobile, plus a
  check-quantities warning Banner. Import photos are never deleted and are
  not the recipe's cover photo (user uploads one in the editor if wanted).
- Stage 3.5 shape: `_url_redraft_job` in `worker.py` handles both redraft
  (payload `{recipe_id, url}`; page text + current saved draft — including
  `tags` and per-ingredient `section` — read from DB at run time) and
  fallback extraction (payload `{url, page_text, image_urls}`, result
  carries `page_text`/`image_urls` so the saved draft stays redraftable and
  keeps its photo candidates). Reviewing a url_redraft result navigates to
  the editor with `prefill` router state; the editor skips overwriting form
  fields from the API load when a prefill is present, and
  `PUT /api/recipes/{id}` uses COALESCE so a null `source_page_text` keeps
  the stored text. `_coerce_recipe` + `RECIPE_JSON_SPEC` in `worker.py` are
  reusable for stage 4's photo import (already ingredient-`section`- and
  `tags`-aware — see "Post-launch fixes" above).
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
  name_note_cleanup|test (migration 004 rebuilt the table). `jobs.recipe_id`
  (migration 007) links a job to the recipe it produced — see "Post-launch
  fixes" above. `GET /api/jobs` returns a per-type `summary` string, not raw
  payloads — extend `_job()` in `jobs.py` when adding a type. UI maps DB
  statuses pending/running/done/failed to Queued/Processing/Done/Failed in
  `InboxPage.jsx` (`STATUS_META`); a `REVIEW_TYPES` job (photo_import,
  url_redraft) 'done' displays as "needs review" until its linked recipe is
  published.
- Astryx gotcha: `StatusDot` takes `variant` (success|error|…) + required
  `label`, not `status`. Design mockups live in the Claude Design project
  (DesignSync tool), not on disk — `ui_kits/recipe-app/import-inbox.html`
  was the template for InboxPage.
- Stage 3 (owner-tested): `_categorise_job` in `worker.py` asks the model
  for a name→category JSON mapping (`_extract_json` strips fences), falls
  back to "other" for unknown categories, and writes back to
  `ingredient_lookup` + still-NULL `ingredients`/`shopping_items` rows only —
  manual overrides made while queued always win (backfilled from lookup, no
  AI call). `enqueue_categorise_job()` now calls `worker.wake()`.
- Testing gotcha: `pkill -f <pattern>` from the Bash tool matches its own
  wrapper shell and kills it (exit 144) — use a bracket pattern like
  `pkill -f "fake_a[i].py"`. For tests, run a fake OpenAI-compatible server
  on port 8021 (port 8020 is taken by an unknown long-lived process): serve
  GET /models and POST /chat/completions, returning fenced recipe JSON when
  the request contains `image_url` parts (past sessions' `fake_ai.py`
  lived in the job scratchpad and is gone — recreate it).

## Product spec

### Purpose & users
A household recipe manager and shared shopping list. Recipes come in via
manual entry, website import, or AI-assisted photo/video import. The
shopping list sorts itself to match the walking route of whichever
supermarket is selected. Small number of household users, created by an
admin (no self-signup/email verification), username+password + session
cookie. All recipe/list/store data is **shared** across the household — no
per-user silos. SSO-ready: auth is isolated in its own module with a config
option (off by default) to trust a reverse-proxy header (e.g. `Remote-User`)
for identity, restricted to configured trusted proxy IPs, so
Authelia/Authentik can be adopted later without a rewrite.

### Feature set
- **Recipes**: title, description, photo, servings, free-form multi tags,
  ingredients, steps, source URL, `status` (`draft`/`published` —
  AI-imported recipes always arrive `draft`). Servings stepper on the detail
  page live-scales displayed ingredient amounts (display only, never
  mutates stored data). Full-text search (FTS5) on title/description/
  ingredients/notes; filter by tags.
- **Cooking notes**: a journal on the recipe detail page (not the editor) —
  free text, automatic timestamp + author, newest-first, lightweight inline
  add box. Append-style history: a note's author (or an admin) can edit/
  delete their own note, but notes are never affected by recipe edits.
  Shared household data; searchable via the same FTS index (a note hit
  surfaces its recipe).
- **Ingredients (structured)**: `amount` (decimal, nullable), `unit`
  (nullable), `name` (required), `note` (nullable), `category_id`,
  `scalable` (bool, default true — non-scalable items like "pinch of salt"
  stay fixed when servings change). **`name` must contain only the shoppable
  item** (litmus test: what you'd write on a shopping list) — preparation
  ("finely diced"), size ("small"), qualifiers ("optional", "divided") all
  belong in `note`. Keeps the ingredient lookup table clean (one "onion"
  regardless of prep) and makes shopping-list duplicate-grouping work.
  Detail page renders the full line from the parts, e.g. "1 onion — small,
  finely diced". Autocomplete on the name field (recipe editor AND shopping
  list manual-add): suggest from `ingredient_lookup` after ≥2 characters,
  starts-with matches first then contains, ordered by `use_count` desc
  within each group; selecting one silently attaches its category; free
  text always allowed, unknown names enter the categorisation flow.
- **Recipe input methods**: manual entry; website URL import (see below);
  AI photo import (multi-photo = one job, lands in the import inbox); AI
  YouTube video import (see above); cross-instance JSON import/export (see
  above).
- **Shopping list**: shared household lists — one default list plus any
  number of extra named lists (tabs on the shopping list page; managed in
  Settings). Sources: per-ingredient "add to list"
  + "add all" from a recipe (always onto the default list), or manual add
  with autocomplete (onto the active tab). Items move between lists (drag a
  row's handle onto a tab, or the row dialog) — always moved, never copied.
  Items are
  **copies, not links** — sending an ingredient copies name/amount/unit/
  category and records the originating `recipe_id` as a tag; editing the
  recipe later never touches the list and vice versa. Duplicates are never
  auto-merged — identical names are visually grouped adjacent to each other
  instead (no unit conversion). Store-ordered sorting: a store selector
  groups items by category, ordered per the selected store's walking route;
  uncategorised items sort into an "Uncategorised" group at the bottom;
  switching stores only changes presentation order, never data.
- **Stores & categories**: categories are an editable list (seed defaults:
  produce, meat & fish, dairy & eggs, bakery, tinned & jarred, dry goods &
  pasta, frozen, drinks, snacks, condiments & spices, household, other).
  Stores are user-defined with a drag-and-drop category ordering
  representing the walking route; new categories default to the end of
  every store's order.
- **Ingredient categorisation flow**: on save, normalise the name (trim,
  lowercase) and check `ingredient_lookup`. Hit → apply stored category, no
  AI. Miss → save uncategorised, enqueue an AI categorisation job; on
  completion apply the category and write it to the lookup table. Manual
  override anywhere (editor or shopping list) writes back to the lookup
  table so it sticks. Uncategorised items are never blocked. Lookup rows
  carry `use_count`, incremented on each use, powering autocomplete ranking.
- **Explicitly NOT in v1 (backlog, do not build)**: meal planning calendar
  (data model shouldn't preclude it, but no schema/UI work now); unit
  conversion / smart merging of duplicate shopping items; per-user private
  recipes or lists; recipe import from other apps (Mealie/Tandoor
  migration — the JSON import/export above is Scran-to-Scran only).

### Architecture
Single Docker container: web app + built-in background worker for the job
queue (no separate Redis/queue container). SQLite on a mounted volume, WAL
mode, FTS5 for search. Uploads (recipe photos, import photos) on a second
mounted volume, referenced by path in the DB. Backup story: stop-free
backup via SQLite online backup or litestream-style copy; at minimum, "copy
the two volumes" is the documented procedure. Config via env vars (DB path,
uploads path, session secret, trusted-proxy-header toggle + allowed proxy
IPs, AI profile defaults); runtime-editable settings (AI profiles, stores,
categories) live in the DB via the Settings UI, not env vars. Outbound
internet access is needed only for user-initiated URL imports and the
configured AI endpoint — no telemetry, no other external calls.

### AI integration & job queue (product-level)
- Multiple named AI profiles (base URL, API key, model name, all
  OpenAI-compatible chat completions); user picks the active one in
  Settings. Typical setup: a local LM Studio profile for everyday work and
  a cloud OpenRouter profile for video (see the dedicated video-purpose
  profile above).
- Jobs persist in `jobs`, survive restarts. Worker probes the active
  endpoint before running; unreachable → jobs stay pending and retry on the
  next poll, so "the local-model PC isn't always on" degrades gracefully
  (photos/videos queue up and process when the endpoint reappears). Failed
  jobs record the error, retry with backoff up to a small max attempts,
  then surface a visible error + manual retry in the import inbox.
- AI drafts always require human review before publishing — never
  auto-applied, never auto-published.

### Screens
Mobile-first; desktop is an enhancement. Primary venues: kitchen (recipe
view) and supermarket (shopping list). Login (minimal) · Recipe browse/home
(card grid, search, tag filter chips, add menu: manual/URL/photo/video/
import-data) · Recipe detail (photo, servings stepper, ingredients with
add-to-list, steps, cooking notes, Edit/Publish/Export) · Recipe editor
(manual entry + all draft review flows: dynamic ingredient rows with
autocomplete, reorderable steps, photo upload, publish/save-draft) · Import
inbox (queued/processing/failed jobs + drafts awaiting review, AI endpoint
status indicator) · Shopping list (list tabs with drag-to-move, store selector,
category-grouped store-ordered items, recipe tags, adjacent duplicate
grouping, manual add, clear-checked) · Settings (AI profiles, stores route
editor, categories, shopping lists, users (admin-only), auth options).

### Settled decisions (do not relitigate)
- Shopping list items are copies with a recipe tag, not live links.
- No auto-merge of duplicate list items; group visually instead.
- AI drafts always require human review before publishing.
- Local lookup table is consulted before any AI categorisation call.
- Meal planning calendar is backlog, not v1.
- Simple auth now, trusted-header SSO support as a config option.
- Frontend is a React SPA built on the Astryx design system (pre-built
  stylesheet path), chosen deliberately as a React learning project — do
  not swap it for server-rendered templates or another component library.
- Theme is strictly **matcha** (`@astryxdesign/theme-matcha`, wired in
  `frontend/src/main.jsx`: `theme.css` import + `matchaTheme` on the
  `Theme` provider). Do not switch themes or override theme tokens.

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
  add a new file. The original 001–009 chain was squashed into one
  `001_initial.sql` baseline after v0.2.13 (pre-squash DBs skip it by
  filename; partially-migrated ones are refused at startup — see
  `LEGACY_MIGRATIONS` in `db.py`). The next migration is `002_*.sql`.
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
