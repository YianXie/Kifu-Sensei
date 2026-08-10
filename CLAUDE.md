# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Kifu-Sensei is an automated Go game commentary generator. Users upload an SGF file, the backend runs a two-pass KataGo analysis to identify the 20 most impactful moves, then calls the Claude API (using the user's own key, stored encrypted) to generate move-by-move commentary. The annotated SGF can be downloaded.

There are three top-level components: `backend/` (FastAPI), `frontend/` (React web app), and `extension/` (a Manifest V3 Chrome side-panel extension that overlays commentary on online-go.com games). All three talk to the same backend API.

## Commands

Four components — `shared/`, `backend/`, `frontend/`, `extension/` — are covered by
`make` and by CI. `install`, `format`, `lint` and `test` each have a `-shared`,
`-backend`, `-frontend` and `-extension` variant; `run` and `build` only exist for
the components that have something to run or build.

### Install

```bash
make install            # all four components
make install-shared     # cd shared && npm install
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
make format     # writes: ruff format + isort (backend), prettier (shared, frontend, extension)
make lint       # read-only: ruff check + ruff format --check + isort --check (backend), eslint + prettier --check (shared, frontend, extension)
make test       # pytest (backend), vitest (shared, frontend, extension)
make build      # tsc -b + vite build (frontend, extension)
make typecheck  # read-only: tsc -b (shared, frontend, extension)
make security   # pip-audit + bandit (backend), npm audit (frontend, extension)
```

### CI

```bash
make ci   # runs ./scripts/ci-local.sh — the same checks as .github/workflows/ci.yml
```

`.github/workflows/ci.yml` has six jobs, which run in parallel:

| Job                | Checks                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `shared`           | eslint, prettier --check, tsc, vitest                              |
| `backend`          | ruff check, ruff format --check, isort --check-only, pytest        |
| `frontend`         | eslint, prettier --check, vitest, `tsc -b` + vite build            |
| `extension`        | eslint, prettier --check, vitest, `tsc -b` + all three vite builds |
| `secret-scan`      | gitleaks over the full commit history                              |
| `dependency-audit` | pip-audit, bandit, npm audit (frontend), npm audit (extension)     |

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
- `routers/go.py` — `GET /api/health/`; `POST /api/commentary/` (synchronous, still served but no longer used by either front end); and the async job pair **both** surfaces now use — `POST /api/commentary/jobs/` (202, returns a job id) and `GET /api/commentary/jobs/{job_id}/` (poll for progress/result). Only the job path reports progress, and only it is covered by the one-active-run-per-user index, so a client on the sync endpoint could neither show progress nor be told a run was already going. A 409 from the job endpoint carries `job_id`, which is what lets either surface attach to a run the other started.
- `services/katago.py` — **Core logic.** Two-pass KataGo analysis:
  1. Fast pass (`maxVisits=50`, no ownership/policy) across all turns to compute winrate diffs.
  2. Detailed pass (`maxVisits=500`, with ownership + policy) on the 20 worst moves and their preceding positions.
  3. Builds rich prompts (ASCII board, KataGo stats, ownership map) and calls Claude (`claude-sonnet-5` by default) once per selected move.
  4. Injects commentary back into the SGF via sgfmill.

**Coordinate system note:** sgfmill uses `(row=0, col=0)` at the bottom-left; KataGo uses column letters `A-T` (skipping `I`) and rows from 1 at the bottom. The display/ownership arrays are top-row-first. Multiple helpers in `katago.py` convert between these.

**Auth flow:** JWT access token (30 min) + refresh token (7 days), both HS256-signed. The `CurrentUser` dependency in `deps.py` resolves the authenticated user for protected routes.

## Frontend Architecture (`frontend/src/`)

**Stack:** React 19 + TypeScript + Vite + axios, styled with the Kifu-Sensei
design system (plain CSS, no component framework).

### Design system

The UI is the Claude Design project `Kifu-Sensei.dc.html`, implemented here.
`styles/ds/` is a near-verbatim copy of that project's CSS — tokens
(`tokens/*.css`) and component layers (`components/{core,forms,surfaces,feedback,navigation,game}.css`),
all keyed on `ks-` class names. Two files are ours rather than the design's:
`components/app.css` (page composition — the design expresses these as inline
styles per screen) and `components/toastify.css` (re-skins react-toastify's
markup as the design's Toast). `src/index.css` imports the lot, in order.

**Colour comes only from the tokens.** Dark is the default; `<html data-theme="light">`
switches. Never hard-code a hex value in a component — every surface, border and
accent has a semantic alias in `tokens/colors.css`.

`components/ui/` holds one React component per design-system component, each
rendering exactly the markup its CSS expects. Compose screens from these rather
than writing new `ks-` classes:

- Core — `Button`, `IconButton`, `Icon`, `Badge`, `Chip`, `Divider`
- Forms — `Field`, `Input`, `Select`, `Textarea`, `Switch`, `SegmentedControl`
- Surfaces — `Card`, `Panel`, `EmptyState`
- Feedback — `Alert`, `Dialog`, `Spinner`, `Tooltip`
- Navigation — `Menu`, `NavList`, `Tabs`, `Drawer`

`Icon` is the one place that touches MUI: the design specifies Material Symbols
Rounded, and `@mui/icons-material` ships the same glyphs as SVG, so there is no
icon-font CDN request and no flash of raw ligature text. Icons are addressed by
Material ligature name (`<Icon name="history" />`) — add an entry to the `GLYPHS`
map in `Icon.tsx` before using a new one. Nothing else imports `@mui/material`;
it stays in `package.json` only because `@mui/icons-material` needs it.

### Files

- `api.ts` — Axios instance with JWT attach interceptor and auto-refresh queue on 401. Tokens in `localStorage`.
- `contexts/AuthContext.tsx` — Auth state, `userSettings` (includes `has_claude_api_key`), login/logout helpers. Hydrates from the stored access token on mount; only a decode failure or a genuine 401 from `/auth/user/settings/` logs the user out, not a transient network error.
- `contexts/ThemeContext.tsx` — Owns the light/dark preference and writes `<html data-theme>`. The navbar toggle and the Settings segmented control both call `setPreference` (immediate, remembered in `localStorage["ks_theme"]`); the signed-in account preference wins whenever the _server's_ value changes, so a local toggle is never clobbered by a re-render.
- `components/layout/Layout.tsx` + `Navbar.tsx` + `Footer.tsx` — Page chrome: top nav (with the account menu and the mobile drawer) and the site footer.
- `components/global/ProtectedRoute.tsx` — Route guard that redirects unauthenticated users to `/login`.
- `pages/Commentary.tsx` — Main feature page, four states: API-key gate, upload, generating, review. Uploads an SGF, submits a job through `useCommentaryJob`, then renders the board plus the scrollable list of `CommentaryCard`s. Also renders a result passed in via router `location.state` (see History below), in which case the API-key gate is skipped since there's nothing left to generate.
- `components/game/GameViewer.tsx` — Composes the board, controls and comment panel, sizing the side column against the board column with a `ResizeObserver`. `children` fill the rest of that column (the review screen's card list); `compact` gives the home-page demo its narrower proportions.
- `components/game/GoBoard.tsx` — Renders the board on a `<canvas>` using `@sabaki/go-board`.
- `components/game/CommentPanel.tsx` — The per-move commentary text, as an `aria-live` region, with stone-colour and severity badges.
- `components/game/CommentaryCard.tsx` — One commented move in the review list; severity rail on the left, matching the extension panel.
- `components/game/Controls.tsx` — Move navigation; jumps to commented turns. Honours the `play_stone_sound` preference.
- `components/commentary/SgfDropzone.tsx` — The `.sgf` upload target.
- `pages/SetupApiKey.tsx` — UI for entering/removing the user's Claude API key.
- `pages/History.tsx` + `components/history/HistoryCard.tsx` / `MiniBoardThumb.tsx` — Paginated list of past commentary runs (`GET /auth/user/commentary-history/`); opening a card fetches the full record (`GET /auth/user/commentary-history/{id}/`) and hands it to `Commentary.tsx` to view.
- `pages/ExtensionReady.tsx` — Writes `localStorage["extension_auth"]` after login, for the extension's auth handoff (see Extension Architecture below).
- `constants/global/endpoints.ts` — All API endpoint URLs (`ENDPOINTS`).
- `utils/errorFormatting.ts` — bridges Axios's error shape onto `@shared/errors`; the wording and precedence live there so both surfaces explain a failure identically.
- `hooks/useCommentaryJob.ts` — submits a commentary job, polls it, resumes it after a reload, and attaches to a run already going on the account (the 409 carries its id).
- `utils/preferences.ts` — Reads free-form `preferences` keys that have no dedicated type, currently `play_stone_sound`.
- `types/auth.ts` — `AuthUser`, `JwtPayload`, `UserSettings`, the token responses. Everything describing the _commentary_ API lives in `@shared/types`.
- `types/theme.ts` — `ThemePreference` / `ResolvedTheme`.
- `pages/` also holds `Home.tsx`, `Login.tsx`, `Register.tsx`, `Logout.tsx`, `Privacy.tsx` (renders `content/privacy-policy.md`) and `NotFoundPage.tsx`.
- `components/commentary/CommentaryConfig.tsx` — the model/language/count/token/instruction form, rendered both on the Commentary page (per-run) and in Settings (as the account default).
- `components/home/Demo.tsx` — the interactive board on the home page, over `constants/commentary/demo.ts`.
- `components/ui/` also exports `Progress`, used by the generating screen.
- `hooks/` — `useMediaQuery`, `usePageTitle`, `useCommentaryJob`.

**User preferences** live in one free-form JSON blob (`PUT /auth/user/settings/`,
which shallow-merges), so each screen may send only its own section: `theme` and
`play_stone_sound` from Settings → Miscellaneous, `commentary_config` from
Settings → Default commentary config or from the extension's config screen.

The extension reads `theme` and `commentary_config` and caches both under
`chrome.storage.local["account_state"]`, because only the panel can call
`/auth/user/settings/` — the service worker and the injected button need that
snapshot to honour the account's settings at all. `play_stone_sound` is
deliberately unread there: the panel has no board and no move stepping.

## Shared Module (`shared/`)

Code the web app and the extension must agree on, compiled from source by both
builds through an `@shared` path alias. There is no package to install and no build
step of its own — only `shared/`'s own lint/typecheck/test.

This exists because the alternative was tried and failed: the commentary-config
validator, the severity thresholds, the model/language lists, the endpoint table and
the error-code union were each hand-copied, with comments in both copies saying
"change all three together", and several had not been.

- `src/commentary.ts` — model/language lists and labels, the bounds the backend
  enforces, `readCommentaryConfig` / `clampCommentaryConfig`, and the display rules:
  `severityForDelta`, `colorForTurn`, `coordinateForTurn`, `formatDelta`, and the
  `SEVERITY_LABELS` / `COLOR_LABELS` both card renderers use.
- `src/types.ts` — every wire shape from `backend/app/schemas.py`, including all nine
  `CommentaryErrorCode`s. Mirror changes here when the backend's schemas move.
- `src/endpoints.ts` — `makeEndpoints(apiUrl)`, the whole URL table. A factory
  because each surface resolves its own base.
- `src/errors.ts` — one message per failure and one precedence rule: client copy for
  a code we recognise, the backend's `detail` only as a fallback.
- `src/download.ts` — the annotated-SGF save. One filename rule, one MIME type.
- `src/jobs.ts` — poll interval, timeouts, and the 15-minute deadline, so both
  surfaces wait the same amount of time for the same backend.
- `styles/tokens/` — the design system's token layer, imported by both
  `frontend/src/index.css` and `extension/panel/panel.css`. `fonts.css` stays in the
  frontend: it `@import`s a CDN, which an extension page must not do at render time.

**Both consumers type-check these sources** (each tsconfig `include`s them), so a
change that breaks either surface fails in that surface's own job.

## Extension Architecture (`extension/`)

**Stack:** Manifest V3 Chrome extension, TypeScript + Vite, no UI framework (plain DOM). Covered by `make` and by CI, same as the other components.

Beyond the side panel, `src/button/` injects a Kifu-Sensei button into the OGS game
page itself (shadow DOM, so neither stylesheet reaches the other) and drives it from
`chrome.storage` — a content script cannot call the backend, since its `fetch`
carries the page's origin and the CORS allowlist does not include online-go.com.

`src/shared/` holds the extension's own plumbing: `api.ts` (`authedFetch`, the single
place a dead session is noticed), `jobs.ts` (the job state machine and its
`chrome.storage` persistence), `ogs.ts` (game detection and the two independent
live-game guards), `constants.ts` (every key that must agree across the three JS
worlds), and `types.ts` (what belongs to the extension alone).

The panel is themed: `panel/theme.ts` mirrors `ThemeContext`, resolving the same
three preferences onto `<html data-theme>` and adopting `preferences.theme` from the
account. It runs first in `init()` so nothing paints before it.

```bash
cd extension && npm install
npm run build      # generates the production manifest, tsc -b, then three vite builds
npm run build:dev  # same, with the localhost host permissions a local backend needs
npm run dev        # plain `vite` — a dev server. It never writes dist/ and never
                   # generates a manifest, so `build:dev` is the load-unpacked path.
npm test        # vitest
npm run lint    # eslint
```

**Three Vite configs, not one.** `vite.config.ts` builds `panel` and `background` as
ES modules. `content` and `inject` have their own configs (`vite.content.config.ts`,
`vite.inject.config.ts`) **because they must be self-contained IIFEs** — Chrome loads
a content script as a classic script, and `inject.ts` is appended to the page as a
plain `<script src>`, so an `import` statement in either fails at runtime. Bundling
them with the module entries lets Rollup hoist shared code into a chunk and emit
exactly that import. This is the single most load-bearing fact about the build.

`manifest.json` is **generated and gitignored** — edit `manifest.template.json`, which
`scripts/build-manifest.mjs` turns into either the production manifest or a
development one with the localhost origins read out of `.env.development`. The
content script runs on all of `online-go.com/*` and the Kifu-Sensei frontend origins.

**The auth handoff is the key cross-file flow.** The extension cannot read the website's `localStorage` directly (different JS worlds and storage areas), so tokens travel through four contexts:

1. `frontend/src/pages/ExtensionReady.tsx` — after web login, writes `{accessToken, refreshToken}` to `localStorage["extension_auth"]`.
2. `extension/src/inject.ts` — injected into the **page context**; polls that `localStorage` key every 500 ms and `postMessage`s any change to the content script.
3. `extension/src/content.ts` — receives the message, validates the access token against `ENDPOINTS.userSettings` (refreshing via `ENDPOINTS.tokenRefresh` if expired), then persists the verified pair to `chrome.storage.local["extension_auth"]`.
4. `extension/panel/panel.ts` — reads `chrome.storage.local`, renders the signed-in/demo screen, and listens via `chrome.storage.onChanged` so it updates live.

**Sign-out is subtle:** the website leaves its own `localStorage["extension_auth"]` in place, so on sign-out `panel.ts` records the revoked refresh token under `chrome.storage.local["revoked_refresh_token"]` and wipes the key from any open frontend tabs. `content.ts` checks that marker before re-adopting a session, so a stale website entry can't silently re-authenticate. Keep the `STORAGE_KEY` / `REVOKED_KEY` / message-source constants in sync between `inject.ts`, `content.ts`, and `panel.ts`.

Config lives in `extension/src/shared/config.ts` (endpoints derived from `VITE_API_URL`). Extension `.env` needs `VITE_API_URL` (backend) and `VITE_FRONTEND_URL` (used by the panel to open login/register/OGS tabs) — see `.env.example`.

## Environment Variables (backend `.env`)

| Variable                      | Required | Notes                                                                                                                                           |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_ENDPOINT`                | Yes      | URL of the KataGo analysis HTTP server                                                                                                          |
| `ENVIRONMENT`                 | Prod     | Set to `production` to enable production checks (non-default secrets required, dev CORS origins dropped). Defaults to `development`.            |
| `SECRET_KEY`                  | Prod     | JWT signing key                                                                                                                                 |
| `ENCRYPTION_KEY`              | Prod     | Fernet key for Claude API key encryption. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ADMIN_USERNAME`              | Prod     | SQLAdmin dashboard login. Must be changed from the `dev-admin` default in production.                                                           |
| `ADMIN_PASSWORD`              | Prod     | SQLAdmin dashboard password. Must be changed from the `dev-admin-password` default in production.                                               |
| `ENABLE_ADMIN`                | No       | Mounts the SQLAdmin dashboard when `true`. Off by default — opt in deliberately, since it's full read/write access to the users table.          |
| `DATABASE_URL`                | No       | Defaults to `sqlite:///./db.sqlite3`                                                                                                            |
| `FRONTEND_URL`                | No       | Added to CORS allowlist in production                                                                                                           |
| `API_TIMEOUT`                 | No       | Seconds to wait for KataGo (default 120)                                                                                                        |
| `COMMENTARY_PIPELINE_WORKERS` | No       | Max concurrent commentary pipelines (KataGo + Anthropic calls) on the dedicated executor, separate from the request threadpool (default 4).     |
| `MAX_REQUEST_BODY_BYTES`      | No       | Requests larger than this are rejected by `Content-Length` before the body is read (default 5,000,000 — headroom over the 2 MB SGF cap).        |

## IMPORTANT: Other things to note

This project is for Kifu-Sensei — a web-application + browser extension tool for providing custom commentary for Go games.

Tech stack:

- Frontend: React and the Kifu-Sensei design system (plain CSS, no component framework)
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
