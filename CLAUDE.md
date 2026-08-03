# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Kifu-Sensei is an automated Go game commentary generator. Users upload an SGF file, the backend runs a two-pass KataGo analysis to identify the 20 most impactful moves, then calls the Claude API (using the user's own key, stored encrypted) to generate move-by-move commentary. The annotated SGF can be downloaded.

There are three top-level components: `backend/` (FastAPI), `frontend/` (React web app), and `extension/` (a Manifest V3 Chrome side-panel extension that overlays commentary on online-go.com games). All three talk to the same backend API.

## Commands

All three components — `backend/`, `frontend/`, `extension/` — are covered by `make`
and by CI. Every `make` target has a `-backend`, `-frontend`, `-extension` variant.

### Install

```bash
make install            # all three components
make install-backend    # cd backend && uv sync --dev
make install-frontend   # cd frontend && npm install
make install-extension  # cd extension && npm install
```

### Dev Servers

```bash
make run-backend   # uvicorn on :8000 with --reload
make run-frontend  # vite dev on :5173
```

### Format, lint, test, build

```bash
make format     # writes: ruff format + isort (backend), prettier (frontend, extension)
make lint       # read-only: ruff check + ruff format --check + isort --check (backend), eslint + prettier --check (frontend, extension)
make test       # pytest (backend), vitest (frontend, extension)
make build      # tsc + vite build (frontend, extension)
make security   # pip-audit + bandit (backend), npm audit (frontend, extension)
```

### CI

```bash
make ci   # runs ./scripts/ci-local.sh — the same checks as .github/workflows/ci.yml
```

`.github/workflows/ci.yml` has five jobs, which run in parallel:

| Job                | Checks                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| `backend`          | ruff check, ruff format --check, isort --check-only, pytest             |
| `frontend`         | eslint, prettier --check, vitest, `tsc -b` + vite build                 |
| `extension`        | eslint, prettier --check, vitest, `tsc` + all four vite builds          |
| `secret-scan`      | gitleaks over the full commit history                                   |
| `dependency-audit` | pip-audit, bandit, npm audit (frontend), npm audit (extension)          |

`scripts/ci-local.sh` runs every check even after one fails, then prints a summary —
so one run surfaces everything rather than only the first problem. It skips gitleaks
with a warning when the binary is not installed (`brew install gitleaks`); CI always
runs it.

**Keep `ci-local.sh` and `ci.yml` in step.** A check in only one of them either gates
nothing or is discovered only after a push.

### Testing

**Backend** — pytest, in `backend/tests/`. `conftest.py` sets the environment
(including `API_ENDPOINT` and a temp-file `DATABASE_URL`) at import time, before
anything under `app` is imported, because `app.config` builds its settings and
`app.database` its engine at module scope. Real environment variables win over
`backend/.env`, so a local `.env` cannot change a test result. Each test gets an
empty database from the autouse `_fresh_database` fixture.

Upstreams are never contacted: KataGo is served by `respx` and Anthropic by a stub
class that replaces `app.services.katago.Anthropic`.

```bash
cd backend && uv run pytest                                    # all
cd backend && uv run pytest tests/test_katago_helpers.py -v    # one file
cd backend && uv run pytest tests/test_auth_router.py::test_register_creates_a_user -v
```

**Frontend and extension** — Vitest + jsdom, configured in `vitest.config.ts` in each
project (kept separate from `vite.config.ts` so the build configs carry nothing
test-only). Tests are colocated as `*.test.ts` / `*.test.tsx`.

- `frontend/src/test/setup.ts` — jest-dom matchers, `matchMedia` and
  `HTMLMediaElement.play` shims that jsdom lacks.
- `extension/src/test/setup.ts` — an in-memory `chrome.storage` fake, installed on
  `globalThis.chrome` before each test. Read it back with `fakeChrome()` to get at the
  spies; `chrome-types` already declares the global, so every access needs a cast.

```bash
cd frontend && npm test           # or npm run test:watch
cd extension && npm test
```

## Backend Architecture (`backend/app/`)

**Stack:** FastAPI + SQLModel (SQLite) + JWT auth + Fernet encryption

Key files:

- `config.py` — Pydantic settings loaded from `.env`. **`API_ENDPOINT` must be set** (points to a running KataGo analysis HTTP server). `ENCRYPTION_KEY` and `SECRET_KEY` must be non-default in production.
- `models.py` — Single `User` model. `claude_api` stores only Fernet ciphertext; plaintext never hits the DB.
- `crypto.py` — `encrypt_secret` / `decrypt_secret` using Fernet derived from `ENCRYPTION_KEY`.
- `routers/auth.py` — registration (`POST /auth/register/`), JWT obtain/refresh (`POST /auth/token/`, `POST /auth/token/refresh/`), server-side revocation (`POST /auth/logout/`), settings and Claude API key CRUD (`GET`/`PUT /auth/user/settings/`, `PUT`/`DELETE /auth/user/claude-api-key/`), email/password update, account deletion (`DELETE /auth/user/delete/`), and paginated commentary history (`GET /auth/user/commentary-history/`, `GET /auth/user/commentary-history/{id}/` for one full record, `DELETE /auth/user/commentary-history/{id}/` to remove one).
- `routers/go.py` — `GET /api/health/`; the synchronous `POST /api/commentary/` used by the web app; and the async job pair the extension uses instead, since a Manifest V3 service worker cannot hold a fetch open for a multi-minute review — `POST /api/commentary/jobs/` (202, returns a job id) and `GET /api/commentary/jobs/{job_id}/` (poll for progress/result).
- `services/katago.py` — **Core logic.** Two-pass KataGo analysis:
    1. Fast pass (`maxVisits=50`, no ownership/policy) across all turns to compute winrate diffs.
    2. Detailed pass (`maxVisits=500`, with ownership + policy) on the 20 worst moves and their preceding positions.
    3. Builds rich prompts (ASCII board, KataGo stats, ownership map) and calls Claude (`claude-sonnet-5` by default) once per selected move.
    4. Injects commentary back into the SGF via sgfmill.

**Coordinate system note:** sgfmill uses `(row=0, col=0)` at the bottom-left; KataGo uses column letters `A-T` (skipping `I`) and rows from 1 at the bottom. The display/ownership arrays are top-row-first. Multiple helpers in `katago.py` convert between these.

**Auth flow:** JWT access token (30 min) + refresh token (7 days), both HS256-signed. The `CurrentUser` dependency in `deps.py` resolves the authenticated user for protected routes.

## Frontend Architecture (`frontend/src/`)

**Stack:** React 18 + TypeScript + Vite + MUI + axios

- `api.ts` — Axios instance with JWT attach interceptor and auto-refresh queue on 401. Tokens in `localStorage`.
- `contexts/AuthContext.tsx` — Auth state, `userSettings` (includes `has_claude_api_key`), login/logout helpers. Hydrates from the stored access token on mount; only a decode failure or a genuine 401 from `/auth/user/settings/` logs the user out, not a transient network error.
- `components/layout/Layout.tsx` + `Navbar.tsx` — Page chrome and top nav, including the mobile drawer.
- `components/global/ProtectedRoute.tsx` — Route guard that redirects unauthenticated users to `/login`.
- `pages/Commentary.tsx` — Main feature page: SGF file upload (drag-and-drop), calls `POST /api/commentary/`, renders the Go board and commentary panel via `GameViewer`. Also renders a result passed in via router `location.state` (see History below), in which case the API-key gate is skipped since there's nothing left to generate.
- `components/game/GameViewer.tsx` — Composes the board, comment panel, and controls, and sizes them against each other with a `ResizeObserver`.
- `components/game/GoBoard.tsx` — Renders the board on a `<canvas>` using `@sabaki/go-board`.
- `components/game/CommentPanel.tsx` — The per-move commentary text, as an `aria-live` region.
- `components/game/Controls.tsx` — Move navigation; jumps to commented turns.
- `pages/SetupApiKey.tsx` — UI for entering/removing the user's Claude API key.
- `pages/History.tsx` + `components/history/HistoryCard.tsx` / `MiniBoardThumb.tsx` — Paginated list of past commentary runs (`GET /auth/user/commentary-history/`); opening a card fetches the full record (`GET /auth/user/commentary-history/{id}/`) and hands it to `Commentary.tsx` to view.
- `pages/ExtensionReady.tsx` — Writes `localStorage["extension_auth"]` after login, for the extension's auth handoff (see Extension Architecture below).
- `constants/global/endpoints.ts` — All API endpoint URLs (`ENDPOINTS`).
- `types/` — `CommentaryResponse`, `CommentaryHistoryItem`, `GameMove`, `AuthUser`/`JwtPayload` TypeScript types.

## Extension Architecture (`extension/`)

**Stack:** Manifest V3 Chrome extension, TypeScript + Vite, no UI framework (plain DOM). Covered by `make` and by CI, same as the other two components.

```bash
cd extension && npm install
npm run build   # tsc + vite → outputs to extension/dist/ (load unpacked in Chrome)
npm run dev     # vite watch
npm test        # vitest
npm run lint    # eslint
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

| Variable                     | Required | Notes                                                                                                                                           |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_ENDPOINT`                | Yes      | URL of the KataGo analysis HTTP server                                                                                                          |
| `ENVIRONMENT`                 | Prod     | Set to `production` to enable production checks (non-default secrets required, dev CORS origins dropped). Defaults to `development`.           |
| `SECRET_KEY`                  | Prod     | JWT signing key                                                                                                                                 |
| `ENCRYPTION_KEY`              | Prod     | Fernet key for Claude API key encryption. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ADMIN_USERNAME`              | Prod     | SQLAdmin dashboard login. Must be changed from the `dev-admin` default in production.                                                          |
| `ADMIN_PASSWORD`              | Prod     | SQLAdmin dashboard password. Must be changed from the `dev-admin-password` default in production.                                              |
| `ENABLE_ADMIN`                | No       | Mounts the SQLAdmin dashboard when `true`. Off by default — opt in deliberately, since it's full read/write access to the users table.          |
| `DATABASE_URL`                | No       | Defaults to `sqlite:///./db.sqlite3`                                                                                                            |
| `FRONTEND_URL`                | No       | Added to CORS allowlist in production                                                                                                           |
| `API_TIMEOUT`                 | No       | Seconds to wait for KataGo (default 120)                                                                                                        |
| `COMMENTARY_PIPELINE_WORKERS` | No       | Max concurrent commentary pipelines (KataGo + Anthropic calls) on the dedicated executor, separate from the request threadpool (default 4).     |
| `MAX_REQUEST_BODY_BYTES`      | No       | Requests larger than this are rejected by `Content-Length` before the body is read (default 5,000,000 — headroom over the 2 MB SGF cap).        |

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
