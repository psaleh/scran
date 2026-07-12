# Scran — guidance for AI agents

Household recipe manager + shopping list, self-hosted in a single Docker
container. The full spec is `recipe-app-spec.md` — read the relevant section
before building a feature, and respect §8 "Settled decisions (do not relitigate)".

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
  Gotcha: the theme provider export is `Theme`, not `XDSTheme`.
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

Build the frontend, start the backend, and drive the real app — there is a
working pattern using `puppeteer-core` (devDependency) with the system
Chromium at `/usr/bin/chromium` against `http://localhost:8000` after
`npm run build`. Screenshot at 390×844 (mobile-first) and check desktop
≥1024px too.
