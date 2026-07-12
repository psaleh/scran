# Scran

Household recipe manager and shopping list. See `recipe-app-spec.md` for the
full specification.

**Stack:** React SPA (Vite + [Astryx](https://github.com/facebook/astryx)
design system, pre-built stylesheet path) · Python FastAPI · SQLite (WAL +
FTS5) · single Docker container.

## Run with Docker (production)

```bash
cp .env.example .env        # then edit: set SCRAN_SESSION_SECRET + admin password
docker compose up -d --build
# open http://localhost:8000
```

Data lives in `./data` (SQLite) and `./uploads` (photos). Backing up = copy
those two directories; for a guaranteed-consistent DB copy use
`sqlite3 data/scran.db ".backup scran-backup.db"` (works while running).

The first start creates an admin user from `SCRAN_ADMIN_USERNAME` /
`SCRAN_ADMIN_PASSWORD` if the users table is empty. Migrations run
automatically on every start.

## Run for development

Backend (terminal 1):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
SCRAN_ADMIN_USERNAME=admin SCRAN_ADMIN_PASSWORD=changeme \
  .venv/bin/uvicorn app.main:app --reload --port 8000
```

Frontend (terminal 2 — Vite proxies `/api` to :8000):

```bash
cd frontend
npm install
npm run dev
# open http://localhost:5173
```

## Layout

```
backend/app/            FastAPI app
backend/app/migrations/ numbered .sql files, applied automatically at startup
backend/app/auth/       isolated auth module (sessions, bcrypt, SSO header option)
frontend/               Vite + React + @astryxdesign/core
Dockerfile              multi-stage: node builds SPA → python serves API + static
docker-compose.yml      example homelab deployment with the two volumes
```

## Auth notes

- Username + password, server-side sessions in SQLite, HttpOnly cookie.
- No self-signup: users are created by an admin (settings UI to come).
- SSO-ready: set `SCRAN_AUTH_TRUST_HEADER=true` plus
  `SCRAN_AUTH_TRUSTED_PROXY_IPS` to accept a `Remote-User` header from
  Authelia/Authentik. The header is ignored unless the request comes from a
  listed proxy IP.

## Astryx tooling

Component docs for AI agents and humans: `cd frontend && npx astryx --help`
(e.g. `npx astryx component Button`, `npx astryx template --list`). The
Astryx MCP server is registered in `.mcp.json`.
