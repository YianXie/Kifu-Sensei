# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Kifu Sensei is an automated Go game commentary generator. Users upload an SGF file, the backend runs a two-pass KataGo analysis to identify the 20 most impactful moves, then calls the Claude API (using the user's own key, stored encrypted) to generate move-by-move commentary. The annotated SGF can be downloaded.

## Commands

### Install

```bash
make install          # installs both backend and frontend
make install-backend  # cd backend && uv sync
make install-frontend # cd frontend && npm install
```

### Dev Servers

```bash
make run-backend   # uvicorn on :8000 with --reload
make run-frontend  # vite dev on :5173
```

### Format

```bash
make format   # ruff + isort (backend), prettier (frontend)
```

### CI (lint + format check + security + build)

```bash
make ci   # runs ./scripts/ci-local.sh
```

CI checks: ruff, isort, pip-audit, bandit (backend) — eslint, prettier, tsc build, npm audit (frontend).

### Run a single backend test

```bash
cd backend && uv run pytest path/to/test_file.py::test_name -v
```

## Backend Architecture (`backend/app/`)

**Stack:** FastAPI + SQLModel (SQLite) + JWT auth + Fernet encryption

Key files:

- `config.py` — Pydantic settings loaded from `.env`. **`API_ENDPOINT` must be set** (points to a running KataGo analysis HTTP server). `ENCRYPTION_KEY` and `SECRET_KEY` must be non-default in production.
- `models.py` — Single `User` model. `claude_api` stores only Fernet ciphertext; plaintext never hits the DB.
- `crypto.py` — `encrypt_secret` / `decrypt_secret` using Fernet derived from `ENCRYPTION_KEY`.
- `routers/auth.py` — JWT token obtain/refresh, registration, account management, Claude API key CRUD.
- `routers/go.py` — Single `POST /api/commentary/` endpoint that triggers the analysis pipeline.
- `services/katago.py` — **Core logic.** Two-pass KataGo analysis:
    1. Fast pass (`maxVisits=50`, no ownership/policy) across all turns to compute winrate diffs.
    2. Detailed pass (`maxVisits=500`, with ownership + policy) on the 20 worst moves and their preceding positions.
    3. Builds rich prompts (ASCII board, KataGo stats, ownership map) and calls Claude (`claude-haiku-4-5`) once per selected move.
    4. Injects commentary back into the SGF via sgfmill.

**Coordinate system note:** sgfmill uses `(row=0, col=0)` at the bottom-left; KataGo uses column letters `A-T` (skipping `I`) and rows from 1 at the bottom. The display/ownership arrays are top-row-first. Multiple helpers in `katago.py` convert between these.

**Auth flow:** JWT access token (30 min) + refresh token (7 days), both HS256-signed. The `CurrentUser` dependency in `deps.py` resolves the authenticated user for protected routes.

## Frontend Architecture (`frontend/src/`)

**Stack:** React 18 + TypeScript + Vite + MUI + axios

- `api.ts` — Axios instance with JWT attach interceptor and auto-refresh queue on 401. Tokens in `localStorage`.
- `contexts/AuthContext.tsx` — Auth state, `userSettings` (includes `has_claude_api_key`), login/logout helpers.
- `pages/Commentary.tsx` — Main feature page: SGF file upload (drag-and-drop), calls `POST /api/commentary/`, renders the Go board and commentary panel.
- `components/GoBoard.tsx` — Renders the board using `@sabaki/go-board`.
- `components/Controls.tsx` + `ControlMoveButton.tsx` — Move navigation; jumps to commented turns.
- `pages/SetupApiKey.tsx` — UI for entering/removing the user's Claude API key.
- `constants.ts` — All API endpoint URLs (`ENDPOINTS`).
- `types/` — `CommentaryResponse`, `GameMove` TypeScript types.

## Environment Variables (backend `.env`)

| Variable         | Required | Notes                                                                                                                                           |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_ENDPOINT`   | Yes      | URL of the KataGo analysis HTTP server                                                                                                          |
| `SECRET_KEY`     | Prod     | JWT signing key                                                                                                                                 |
| `ENCRYPTION_KEY` | Prod     | Fernet key for Claude API key encryption. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `DATABASE_URL`   | No       | Defaults to `sqlite:///./db.sqlite3`                                                                                                            |
| `FRONTEND_URL`   | No       | Added to CORS allowlist in production                                                                                                           |
| `API_TIMEOUT`    | No       | Seconds to wait for KataGo (default 120)                                                                                                        |
