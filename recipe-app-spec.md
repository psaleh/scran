# Recipe App — Project Specification

**Version:** 1.0 (design phase complete)
**Deployment target:** Self-hosted Docker container in a homelab. Local-first — no mandatory cloud services.
**Owner context:** Maintainer is an IT infrastructure engineer with scripting experience, not a full-time developer. Prefer boring, well-documented, low-maintenance technology choices. Code should be readable and well-commented.

---

## 1. Purpose

A household recipe manager and shopping list app. Recipes come in via manual entry, website import, or AI-assisted photo import. The shopping list is shared across the household and sorts itself to match the walking route of whichever supermarket is selected.

## 2. Users & authentication

- Small number of household users, created by an admin (no self-signup, no email verification).
- Simple username + password login (session cookie).
- All recipe, shopping list, and store data is **shared** across the household (no per-user silos in v1).
- **SSO-ready:** authentication code must be isolated in its own module. Add a config option (off by default) to trust a reverse-proxy header (e.g. `Remote-User`) for identity, so Authelia/Authentik can be adopted later without a rewrite. When header-trust mode is on, only accept the header from configured trusted proxy IPs.

## 3. Feature set — v1

### 3.1 Recipes
- CRUD for recipes: title, description, photo, servings, tags (free-form, multi), ingredients, steps, source URL (if imported), status.
- **Status field:** `draft` or `published`. AI-imported recipes always arrive as `draft` and require human review before publishing.
- **Serving scaling:** UI stepper on the recipe view adjusts servings; scalable ingredient amounts recalculate live. Display only — never mutates stored data.
- **Tags & search:** full-text search on title/description/ingredients; filter by tags. Search must be fast and local (SQLite FTS5 is the expected mechanism).

### 3.1.1 Cooking notes
- A notes section on the **recipe detail page** (NOT part of the recipe editor). Think cooking journal: quick observations after making the dish.
- Each note: free text, automatic timestamp, and the user who wrote it. Displayed newest-first on the recipe page.
- Adding a note is a lightweight inline action on the recipe page (small text box + save) — no navigation away, no edit mode.
- Notes are append-style history: a note's author (or an admin) can edit or delete their own note, but notes are never affected by edits to the recipe itself.
- Notes are shared household data, visible to all users.
- Notes are searchable via the same full-text search as recipes (a hit in a note surfaces its recipe).

### 3.2 Ingredients (structured)
Each ingredient row on a recipe:
- `amount` (decimal, nullable), `unit` (text, nullable), `name` (text, required)
- `category_id` — links to grocery category (see 3.5)
- `scalable` (boolean, default true) — non-scalable items (e.g. "pinch of salt", "1 bay leaf") stay fixed when servings change.

**Autocomplete on the name field** (applies in recipe editor AND shopping list manual-add):
- Suggest from the ingredient lookup table after ≥2 characters.
- Ranking: starts-with matches first, then contains matches; within each group, order by `use_count` descending.
- Selecting a suggestion silently attaches the known category.
- Free text always allowed — never force a selection. Unknown names enter the categorisation flow (3.6).
- Purely local queries against SQLite; must feel instant.

### 3.3 Recipe input methods
1. **Manual entry** — form with dynamic ingredient rows (autocomplete per 3.2) and step list.
2. **Website import** — user pastes a URL; server fetches the page and parses schema.org/Recipe structured data (JSON-LD preferred, microdata fallback). Result opens pre-filled in the editor for review. Store the source URL. Fail gracefully with a clear message when a site has no structured data.
3. **AI photo import** — user uploads photo(s) of cookbook/magazine pages (multi-page recipes supported: multiple photos = one job). Photos land in an **import inbox** as queued jobs. See section 5 (AI integration & job queue). Output is a `draft` recipe with photos attached for side-by-side review.

### 3.4 Shopping list
- One shared household list.
- **Sources of items:**
  - From a recipe: per-ingredient "add to list" button AND "add all ingredients" button.
  - Manual add (with autocomplete per 3.2).
- **Items are copies, not links:** sending an ingredient copies name/amount/unit/category into the shopping item and records the originating `recipe_id` as a tag. Editing the recipe later never alters the list; editing a list item never alters the recipe.
- Each item shows its recipe tag (if any). Manual items have no tag.
- **Duplicates:** do NOT auto-merge. Identical names are visually grouped adjacent to each other so the shopper sees "tomatoes ×2 (Recipe A, Recipe B)" as consecutive lines. No unit conversion in v1.
- Check-off interaction (tap to strike through), "clear checked" and "clear all" actions.
- **Store-ordered sorting:** a store selector at the top of the list. Items are grouped by category, and the category groups are ordered according to the selected store's walking route (3.5). Items with no category appear in an "Uncategorised" group at the bottom. Switching stores only changes presentation order, never data.

### 3.5 Stores & categories
- **Categories:** editable list of grocery categories (seed defaults: produce, meat & fish, dairy & eggs, bakery, tinned & jarred, dry goods & pasta, frozen, drinks, snacks, condiments & spices, household, other).
- **Stores:** user-defined (e.g. "Tesco Spennymoor", "Aldi"). Each store has a drag-and-drop ordering of the categories representing the walking route through that store. New categories default to the end of every store's order.

### 3.6 Ingredient categorisation flow
1. On ingredient save, normalise the name (trim, lowercase for matching) and check the **ingredient lookup table**.
2. **Hit:** apply the stored category. No AI involved.
3. **Miss:** save the ingredient uncategorised and enqueue an AI categorisation job (section 5). When the job completes, apply the category and write it to the lookup table.
4. **Manual override anywhere** (recipe editor or shopping list): user can recategorise any ingredient; the correction is written back to the lookup table so it sticks for the future.
5. Uncategorised items are never blocked — they simply sort into the "Uncategorised" group.
6. Lookup table rows carry `use_count`, incremented on each use, powering autocomplete ranking.

### 3.7 Backlog (explicitly NOT in v1 — do not build)
- Meal planning calendar (data model should not preclude it, but no schema or UI work now).
- Unit conversion / smart merging of duplicate shopping items.
- Per-user private recipes or lists.
- Recipe import from other apps (e.g. Mealie/Tandoor migration).

## 4. Architecture

### 4.1 Overview
- **Single Docker container** containing the web app and a built-in background worker for the job queue (no separate Redis/queue container — keep ops simple).
- **SQLite** database file on a mounted volume. Enable WAL mode. Use FTS5 for search.
- **Uploads** (recipe photos, import photos) stored on a second mounted volume, referenced by path in the DB.
- Backup story: stop-free backup via SQLite online backup or litestream-style copy; at minimum, document "copy the two volumes" as the backup procedure.

### 4.2 Stack (decided)
- **Frontend: React SPA using the Astryx design system** (`@astryxdesign/core`, MIT, by Meta — https://github.com/facebook/astryx). Use Astryx's real components; do not hand-roll lookalike components when an Astryx equivalent exists. Start with the **pre-built stylesheet path** (simple CSS import + theme provider, no StyleX build plugin) to keep tooling minimal; the StyleX source-build path is a later optimisation only if bundle size matters. Pick one of Astryx's ready-made themes and customise tokens (colour, radius, typography) to taste. Use the Astryx CLI/MCP tooling during development so AI agents work against the documented component API.
- Maintainer note: owner is learning React with this project — prefer clear, idiomatic, well-commented React (function components + hooks, no exotic patterns), and keep the build tooling standard (Vite).
- Backend: Python + FastAPI or Flask serving a JSON API (maintainer-friendly for a scripting background), or Node/Express if it materially simplifies. Keep dependency count low. The single container serves both the API and the built frontend assets.
- **Mobile-first PWA:** responsive layout, web app manifest, service worker for installability. Offline behaviour: at minimum, the shopping list page should remain readable if connectivity blips (nice-to-have, not a blocker).

### 4.3 Container & config
- Configuration via environment variables: DB path, uploads path, session secret, trusted-proxy-header auth toggle + allowed proxy IPs, AI profile defaults.
- Runtime-editable settings (AI profiles, stores, categories) live in the DB via a settings UI, not env vars.
- Provide a `docker-compose.yml` example with the two volumes.
- Healthcheck endpoint for container monitoring.
- Outbound internet access required only for website import and (optionally) cloud AI.

### 4.4 Data model (agreed)
Tables:
- **users** (id, username, password_hash, is_admin, created_at)
- **recipes** (id, title, description, servings, tags, photo_path, source_url, status[draft|published], created_by, created_at, updated_at)
- **ingredients** (id, recipe_id FK, position, amount, unit, name, category_id FK nullable, scalable bool)
- **steps** (id, recipe_id FK, position, text)
- **recipe_notes** (id, recipe_id FK, user_id FK, text, created_at, updated_at)
- **categories** (id, name)
- **stores** (id, name)
- **store_category_order** (store_id FK, category_id FK, position) — composite PK
- **shopping_items** (id, name, amount, unit, category_id FK nullable, recipe_id FK nullable, checked bool, added_by, created_at)
- **ingredient_lookup** (ingredient_name PK normalised, category_id FK, use_count int)
- **jobs** (id, type[photo_import|categorise], status[pending|running|done|failed], payload JSON, result JSON, error text, attempts, created_at, updated_at)
- **ai_profiles** (id, name, base_url, api_key, model, is_default) — API keys stored server-side only, never sent to the browser.

Tags may be a simple comma/JSON field in v1; a proper tags join table is acceptable if search stays simple.

## 5. AI integration & job queue

### 5.1 AI profiles
- Multiple named profiles, each: base URL, API key, model name. All targets speak the **OpenAI-compatible chat completions API**.
- Expected profiles: "Local PC" (LM Studio, e.g. `http://<pc-hostname>:1234/v1`, vision-capable Gemma-class model) and "OpenRouter" (cloud, user's own key).
- User selects the active profile in settings; can switch anytime.

### 5.2 Job queue behaviour
- Jobs persist in the `jobs` table; survive container restarts.
- Worker loop polls for pending jobs. Before running, it probes the active AI endpoint (cheap request with short timeout). Unreachable endpoint → jobs stay pending, retry on next poll (e.g. every 2–5 minutes). This handles the "PC isn't always on" case: photos queue up and process when the endpoint appears.
- Failed jobs record the error, retry with backoff up to a small max attempts, then mark failed with a visible error in the import inbox and a manual retry button.
- Import inbox UI shows each job: thumbnail, status (queued / processing / needs review / failed), and actions.

### 5.3 Photo import job
- Input: 1..n photos for one recipe. Send images directly to the vision model with a prompt requesting **structured JSON only**: title, description, servings, ingredients[{amount, unit, name}], steps[]. Parse defensively (strip markdown fences, validate, tolerate nulls).
- Output: create a `draft` recipe with the parsed data and original photos attached. Ingredient names then run through the categorisation flow (3.6).
- Review screen: original photo(s) side-by-side (or stacked on mobile) with the editable draft. Publish button flips status to `published`.
- Never auto-publish. Emphasise in the review UI that quantities should be checked (models misread numbers).

### 5.4 Categorisation job
- Input: batch of unknown ingredient names + the current category list. Prompt for JSON mapping name → category (must be one of the provided categories or "other").
- On completion: apply to the ingredients and write to `ingredient_lookup`.
- Batch multiple pending names into one request where possible.

## 6. Screens (for design phase)

Mobile-first; desktop is an enhancement. Primary venues: kitchen (recipe view) and supermarket (shopping list).

1. **Login** — minimal.
2. **Recipe browse (home)** — card grid with photo, title, tags; search bar; tag filter chips; add button (menu: manual / from URL / from photo).
3. **Recipe detail** — photo, title, tags, servings stepper (live scaling), ingredient list with per-item add-to-list buttons + "add all", steps, and a **cooking notes section** (timestamped, author-attributed notes with an inline add box; newest first). Edit button.
4. **Recipe editor** — used for manual entry, URL-import review, and draft review. Dynamic ingredient rows with autocomplete; reorderable steps; photo upload; publish/save-draft.
5. **Import inbox** — queued/processing/failed photo jobs and drafts awaiting review; AI endpoint status indicator (reachable/unreachable, active profile name).
6. **Shopping list** — store selector; category-grouped, store-ordered items; recipe tags on items; adjacent grouping of same-name items; tap to check off; manual add with autocomplete; clear-checked.
7. **Settings** — AI profiles; stores (with drag-and-drop category route editor); categories; users (admin only); auth options.

## 7. Non-functional requirements

- Fast on a phone over home Wi-Fi; search and autocomplete feel instant.
- All AI features degrade gracefully: the app is fully usable with no AI endpoint configured or reachable (photo import queues; categorisation falls back to manual/uncategorised).
- No telemetry, no external calls except: user-initiated URL imports, and the configured AI endpoint.
- API keys never exposed to the browser.
- Sensible empty states (fresh install shows helpful "add your first recipe" prompts, seeded default categories).
- Database migrations handled automatically on container start.

## 8. Settled decisions (do not relitigate)

- Shopping list items are copies with a recipe tag, not live links.
- No auto-merge of duplicate list items; group visually instead.
- AI drafts always require human review before publishing.
- Local lookup table is consulted before any AI categorisation call.
- Meal planning calendar is backlog, not v1.
- Simple auth now, trusted-header SSO support as a config option.
- Frontend is a React SPA built on the Astryx design system (pre-built stylesheet path), chosen deliberately as a React learning project — do not swap it for server-rendered templates or another component library.
