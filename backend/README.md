# Kifu-Sensei Backend

FastAPI backend for Kifu-Sensei. Provides JWT authentication, user settings, an
encrypted Claude-API-key store, saved commentary history, a SQLAdmin dashboard, and
the SGF → KataGo → Claude game-commentary pipeline.

## Stack

- **FastAPI** (ASGI, served by Uvicorn)
- **SQLModel** (SQLAlchemy + Pydantic) over SQLite (dev) / PostgreSQL (prod)
- **PyJWT** for access/refresh JWTs
- **pwdlib** (bcrypt) for password hashing
- **cryptography** (Fernet) to encrypt users' Claude API keys at rest
- **anthropic** SDK to call Claude for commentary
- **httpx** + **sgfmill** for KataGo analysis and SGF parsing/annotation
- **SQLAdmin** (+ **itsdangerous** sessions) for the `/admin` dashboard
- **Alembic** for migrations

## Setup

```bash
cd backend
uv sync                 # or: pip install -e . (and the dev group)
cp .env.example .env    # then edit values (API_ENDPOINT is required)
```

## Running

```bash
uv run uvicorn app.main:app --reload --port 8000
```

The database and its tables are created automatically on startup (`init_db()` in the
app lifespan). The KataGo HTTP client is closed cleanly on shutdown. Interactive API
docs are at `http://localhost:8000/docs`; the admin dashboard is at
`http://localhost:8000/admin`.

## Project layout (`app/`)

| File / dir           | Responsibility                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `main.py`            | App factory: lifespan (`init_db` / close KataGo client), CORS, error handlers, routers, SQLAdmin views. |
| `config.py`          | Pydantic `Settings` from `.env`; production guards; `cors_origins` helper.                              |
| `database.py`        | SQLModel engine + `init_db()` + session dependency.                                                     |
| `deps.py`            | `CurrentUser` / `SessionDep` FastAPI dependencies (resolves the authenticated user).                    |
| `security.py`        | JWT encode/decode + password hashing/verification helpers.                                              |
| `crypto.py`          | Fernet `encrypt_secret` / `decrypt_secret` for the Claude API key.                                      |
| `models.py`          | `User` and `Commentary` SQLModel tables.                                                                |
| `schemas.py`         | Request/response Pydantic models (validation lives here).                                               |
| `errors.py`          | Centralized exception handlers registered on the app.                                                   |
| `admin_auth.py`      | SQLAdmin `AuthenticationBackend` (username/password → session).                                         |
| `routers/auth.py`    | Auth, account management, Claude API key CRUD, commentary history.                                      |
| `routers/go.py`      | The single commentary-generation endpoint.                                                              |
| `services/katago.py` | **Core logic** — two-pass KataGo analysis, prompt building, Claude calls, SGF annotation.               |

## Data models (`models.py`)

- **`User`** — `id`, unique `email`, `hashed_password`, `claude_api` (Fernet
  **ciphertext** only; plaintext never touches the DB), a JSON `preferences` blob
  (theme + default `commentary_config`), and `created_at`. Exposes a
  `has_claude_api_key` property. Default preferences are defined by
  `DEFAULT_USER_PREFERENCES`.
- **`Commentary`** — a saved review: `user_id` (FK), `board_size`, `sgf_file_name`,
  `language`, and JSON columns for `moves`, `initial_stones`, `comments`, plus the
  `annotated_sgf_content` and `created_at`. Backs the commentary-history endpoint.

## Endpoints

| Method | Path                             | Auth | Description                                       |
| ------ | -------------------------------- | ---- | ------------------------------------------------- |
| POST   | `/auth/register/`                | No   | Create an account                                 |
| POST   | `/auth/token/`                   | No   | Log in → `{access, refresh, user}`                |
| POST   | `/auth/token/refresh/`           | No   | Exchange a refresh token → `{access, refresh}`    |
| GET    | `/auth/user/settings/`           | Yes  | Read preferences + `has_claude_api_key`           |
| PUT    | `/auth/user/settings/`           | Yes  | Update preferences                                |
| PUT    | `/auth/user/claude-api-key/`     | Yes  | Set/replace the Claude API key (stored encrypted) |
| DELETE | `/auth/user/claude-api-key/`     | Yes  | Remove the stored Claude API key                  |
| POST   | `/auth/user/update-email/`       | Yes  | Change email (requires password)                  |
| POST   | `/auth/user/update-password/`    | Yes  | Change password (requires current password)       |
| GET    | `/auth/user/commentary-history/` | Yes  | List the user's saved reviews                     |
| DELETE | `/auth/user/delete/`             | Yes  | Delete the current account                        |
| GET    | `/api/health/`                   | No   | Health check                                      |
| POST   | `/api/commentary/`               | Yes  | Generate KataGo + Claude commentary from an SGF   |

Authenticated requests use the `Authorization: Bearer <access_token>` header. The
`CurrentUser` dependency (`deps.py`) validates the access JWT and loads the user.

The commentary request accepts `sgf_content`, `sgf_file_name`, `model`
(`claude-fable-5` | `claude-opus-5` | `claude-sonnet-5` | `claude-haiku-4-5`), `language`
(`english` | `chinese (simplified)` | `japanese` | `korean`), `num_comments`
(1–100), `max_token` (256–8192), and an optional `custom_instruction` (≤1000 chars) —
see `GenerateCommentaryRequest` in `schemas.py`.

## Admin dashboard

`main.py` mounts **SQLAdmin** at `/admin` with a session-based
`AuthenticationBackend` (`admin_auth.py`). Log in with `ADMIN_USERNAME` /
`ADMIN_PASSWORD`. `UserAdmin` hides the password hash and encrypted API key;
`CommentaryAdmin` lists saved reviews. In production the admin credentials must be
changed from their dev defaults (enforced in `config.py`).

## Authentication

- JWT **access token** (default 30 min) + **refresh token** (default 7 days), both
  HS256-signed with `SECRET_KEY`. Lifetimes are configurable via `config.py`.
- Passwords are hashed with bcrypt (`pwdlib`).
- The Claude API key is encrypted with **Fernet** (`crypto.py`) using a key derived
  from `ENCRYPTION_KEY`; only ciphertext is stored.

## Commentary pipeline (`services/katago.py`)

1. **Fast pass** (`maxVisits=50`, no ownership/policy) across all turns to compute
   win-rate diffs and find the most impactful moves.
2. **Detailed pass** (`maxVisits=500`, with ownership + policy) on the selected worst
   moves and their preceding positions.
3. Builds rich prompts (ASCII board, KataGo stats, ownership map, principal variation)
   and calls Claude once per selected move.
4. Injects the commentary back into the SGF via sgfmill (`C[]` properties).

> **Coordinate systems:** sgfmill uses `(row=0, col=0)` at the bottom-left; KataGo uses
> column letters `A–T` (skipping `I`) with rows numbered from 1 at the bottom; display
> and ownership arrays are top-row-first. Several helpers in `katago.py` convert between
> these — take care when editing them.

## Environment variables (`.env`)

| Variable         | Required      | Notes                                                                                                                                    |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `API_ENDPOINT`   | **Always**    | Base URL of the KataGo analysis HTTP server. Enforced at startup even in dev.                                                            |
| `ENVIRONMENT`    | No            | `development` (default) or `production`. Production toggles the guards below.                                                            |
| `SECRET_KEY`     | Prod          | JWT signing key. Must be non-default in production.                                                                                      |
| `ENCRYPTION_KEY` | Prod          | Fernet key for API-key encryption. Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ADMIN_USERNAME` | Prod          | SQLAdmin login. Must be non-default in production.                                                                                       |
| `ADMIN_PASSWORD` | Prod          | SQLAdmin password. Must be non-default in production.                                                                                    |
| `DATABASE_URL`   | No            | Defaults to `sqlite:///./db.sqlite3`. Use a PostgreSQL URL in production.                                                                |
| `FRONTEND_URL`   | No (prod rec) | Added to the CORS allowlist (localhost:5173 is always allowed).                                                                          |
| `API_TIMEOUT`    | No            | Seconds to wait for KataGo (default 120).                                                                                                |

In `production`, `config.py` raises at startup if `SECRET_KEY`, `ENCRYPTION_KEY`, or the
admin credentials are still their insecure dev defaults, and always requires
`API_ENDPOINT`.

## Testing, linting, migrations

```bash
uv run pytest                                       # the whole suite
uv run pytest tests/test_katago_helpers.py -v       # one file
uv run pytest tests/test_crypto.py::test_roundtrip_returns_the_original_plaintext -v
uv run ruff check . && uv run ruff format --check . && uv run isort --check-only .
uv run alembic upgrade head                         # apply migrations
```

All of the above except migrations run in CI (`make ci` from the repo root).

### How the test suite is wired

Tests live in `tests/`, one file per module under test.

| File                       | Covers                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| `test_config.py`           | Settings loading, CORS origins, the production start-up guards           |
| `test_crypto.py`           | Fernet round-trip, key isolation, tamper rejection                       |
| `test_security.py`         | Password hashing, JWT minting, and every way a token can be rejected     |
| `test_deps.py`             | Authentication of protected routes                                       |
| `test_errors.py`           | The exception handlers and the status/`code` mapping                     |
| `test_auth_router.py`      | `/auth/*` — registration, tokens, settings, API key, account management  |
| `test_go_router.py`        | `/api/*` — commentary, error classification, the async job lifecycle     |
| `test_katago_helpers.py`   | The pure helpers in `services/katago.py`, above all coordinate conversion |
| `test_katago_pipeline.py`  | `generate_commentary` end to end, with both upstreams faked              |

**No test touches a real service.** KataGo is served by `respx` and Anthropic by a stub
class that replaces `app.services.katago.Anthropic`, so the suite needs neither an
analysis server nor a Claude API key.

`conftest.py` sets the environment — including `API_ENDPOINT` and a temp-file
`DATABASE_URL` — at import time, before anything under `app` is imported: `app.config`
builds its `Settings` at module scope and raises when `API_ENDPOINT` is unset, and
`app.database` builds its engine from `DATABASE_URL` the moment it is imported. Real
environment variables take precedence over `backend/.env`, so a local `.env` cannot
change a test result.

Fixtures worth knowing:

- `_fresh_database` (autouse) — drops and recreates every table around each test.
- `hashed_test_password` (session-scoped) — bcrypt is deliberately slow, so the shared
  test password is hashed once for the whole run.
- `make_user` / `user` — insert a user straight into the database.
- `auth_headers` — a bearer header minted directly, skipping a bcrypt verify per test.
- `client` — a `TestClient` over the real app.
