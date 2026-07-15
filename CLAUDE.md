# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Kifu-Sensei is an automated Go game commentary generator. Users upload an SGF file, the backend runs a two-pass KataGo analysis to identify the 20 most impactful moves, then calls the Claude API (using the user's own key, stored encrypted) to generate move-by-move commentary. The annotated SGF can be downloaded.

There are three top-level components: `backend/` (FastAPI), `frontend/` (React web app), and `extension/` (a Manifest V3 Chrome side-panel extension that overlays commentary on online-go.com games). All three talk to the same backend API.

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

## Extension Architecture (`extension/`)

**Stack:** Manifest V3 Chrome extension, TypeScript + Vite, no UI framework (plain DOM). Not part of `make` or `make ci` — build it separately.

```bash
cd extension && npm install
npm run build   # tsc + vite → outputs to extension/dist/ (load unpacked in Chrome)
npm run dev     # vite watch
```

Vite has four entry points (`vite.config.ts`): `panel` (side panel HTML/TS), `background` (service worker), `content` (content script), `inject` (page-context script). The extension runs on `online-go.com/game/*` and the Kifu-Sensei frontend origins (see `manifest.json` `content_scripts` / `host_permissions`).

**The auth handoff is the key cross-file flow.** The extension cannot read the website's `localStorage` directly (different JS worlds and storage areas), so tokens travel through four contexts:

1. `frontend/src/pages/ExtensionReady.tsx` — after web login, writes `{accessToken, refreshToken}` to `localStorage["extension_auth"]`.
2. `extension/src/inject.ts` — injected into the **page context**; polls that `localStorage` key every 500 ms and `postMessage`s any change to the content script.
3. `extension/src/content.ts` — receives the message, validates the access token against `ENDPOINTS.userSettings` (refreshing via `ENDPOINTS.tokenRefresh` if expired), then persists the verified pair to `chrome.storage.local["extension_auth"]`.
4. `extension/panel/panel.ts` — reads `chrome.storage.local`, renders the signed-in/demo screen, and listens via `chrome.storage.onChanged` so it updates live.

**Sign-out is subtle:** the website leaves its own `localStorage["extension_auth"]` in place, so on sign-out `panel.ts` records the revoked refresh token under `chrome.storage.local["revoked_refresh_token"]` and wipes the key from any open frontend tabs. `content.ts` checks that marker before re-adopting a session, so a stale website entry can't silently re-authenticate. Keep the `STORAGE_KEY` / `REVOKED_KEY` / message-source constants in sync between `inject.ts`, `content.ts`, and `panel.ts`.

Config lives in `extension/src/shared/config.ts` (endpoints derived from `VITE_API_URL`). Extension `.env` needs `VITE_API_URL` (backend) and `VITE_FRONTEND_URL` (used by the panel to open login/register/OGS tabs) — see `.env.example`.

## Environment Variables (backend `.env`)

| Variable         | Required | Notes                                                                                                                                           |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_ENDPOINT`   | Yes      | URL of the KataGo analysis HTTP server                                                                                                          |
| `SECRET_KEY`     | Prod     | JWT signing key                                                                                                                                 |
| `ENCRYPTION_KEY` | Prod     | Fernet key for Claude API key encryption. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `DATABASE_URL`   | No       | Defaults to `sqlite:///./db.sqlite3`                                                                                                            |
| `FRONTEND_URL`   | No       | Added to CORS allowlist in production                                                                                                           |
| `API_TIMEOUT`    | No       | Seconds to wait for KataGo (default 120)                                                                                                        |

## IMPORTANT: Other things to note

This project is for Kifu-Sensei — a web-application + browser extension tool for providing custom commentary for Go games.

Tech stack:

- Frontend: React and Material UI
- Backend: FastAPI, Alembic, and SQLAlchemy
- Database: SQLite3 (local) and PostgreSQL (production)
- GitHub Action:
    - Frontend: linting & formatting with Prettier and ESLint
    - Backend: linting & formatting with Ruff and isort
    - Security Check: pip-audit, bandit, and npm audit
- Deployment: deployed on Render — frontend, backend, and database

Conventions:

- Use type hints on all function signatures.
- Never commit API keys, environmental variables, or sensitive credentials. Use env vars.

When suggesting code:

- Follow existing patterns before introducing new ones.
- Include error handling. No bare except clauses.
- Run linting mentally before presenting code.
- If you're unsure about a library or API, say so.

When debugging:

- Ask for the error message and relevant code first.
- Don't guess at fixes without seeing the actual error.
