# Kifu-Sensei Backend

FastAPI backend for Kifu-Sensei. Provides JWT authentication, user settings, an
encrypted per-account AI-provider credential store (Claude or any
OpenAI-compatible endpoint — OpenAI, vLLM, Ollama), saved commentary history, a
SQLAdmin dashboard, and the SGF → KataGo → LLM game-commentary pipeline.

## Stack

- **FastAPI** (ASGI, served by Uvicorn)
- **SQLModel** (SQLAlchemy + Pydantic) over SQLite (dev) / PostgreSQL (prod)
- **PyJWT** for access/refresh JWTs
- **pwdlib** (bcrypt) for password hashing
- **cryptography** (Fernet) to encrypt users' AI provider credentials at rest
- **anthropic** SDK for the Claude transport; **httpx** for the OpenAI
  Chat Completions-compatible transport (OpenAI, vLLM, Ollama)
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
| `crypto.py`          | Fernet `encrypt_secret` / `decrypt_secret` for AI provider credentials.                                 |
| `models.py`          | `User`, `AIProviderConfig`, and `Commentary` SQLModel tables.                                           |
| `schemas.py`         | Request/response Pydantic models (validation lives here).                                               |
| `errors.py`          | Centralized exception handlers registered on the app.                                                   |
| `admin_auth.py`      | SQLAdmin `AuthenticationBackend` (username/password → session).                                         |
| `routers/auth.py`    | Auth, account management, provider-neutral AI config CRUD + legacy Claude key route, commentary history. |
| `routers/go.py`      | The commentary endpoints (synchronous + async jobs).                                                    |
| `services/katago.py` | **Core logic** — two-pass KataGo analysis, prompt building, provider dispatch, SGF annotation.          |
| `services/providers.py` | Provider boundary: `ClaudeProvider` (Anthropic) and `OpenAICompatibleProvider` (OpenAI/vLLM/Ollama). |

## Data models (`models.py`)

- **`User`** — `id`, unique `email`, `hashed_password`, `claude_api` (Fernet
  **ciphertext** only; plaintext never touches the DB — the legacy column, still
  written by the compatibility route and read as a fallback), a JSON `preferences`
  blob (theme + default `commentary_config`), and `created_at`. Exposes a
  `has_claude_api_key` property. Default preferences are defined by
  `DEFAULT_USER_PREFERENCES`.
- **`AIProviderConfig`** — the provider-neutral configuration, one row per user:
  `provider` (`claude` | `openai-compatible`), `encrypted_api_key` (Fernet
  ciphertext, nullable for local servers that need no auth), optional `base_url`,
  and `model`. The settings API returns only safe metadata from it — provider,
  model, base URL, and whether a credential exists — never plaintext or ciphertext.
- **`Commentary`** — a saved review: `user_id` (FK), `board_size`, `sgf_file_name`,
  `language`, and JSON columns for `moves`, `initial_stones`, `comments`, plus the
  `annotated_sgf_content` and `created_at`. Backs the commentary-history endpoint.

## Endpoints

| Method | Path                             | Auth | Description                                       |
| ------ | -------------------------------- | ---- | ------------------------------------------------- |
| POST   | `/auth/register/`                | No   | Create an account                                 |
| POST   | `/auth/token/`                   | No   | Log in → `{access, refresh, user}`                |
| POST   | `/auth/token/refresh/`           | No   | Exchange a refresh token → `{access, refresh}`    |
| POST   | `/auth/logout/`                  | Yes  | Invalidate every outstanding access/refresh token  |
| GET    | `/auth/user/settings/`           | Yes  | Read preferences + `has_claude_api_key` + provider metadata (`ai_provider`) |
| PUT    | `/auth/user/settings/`           | Yes  | Update preferences                                |
| GET    | `/auth/user/ai-provider/`        | Yes  | Provider-neutral AI config metadata (provider, model, base URL, `has_api_key`) |
| PUT    | `/auth/user/ai-provider/`        | Yes  | Create/update the provider config (Claude or OpenAI-compatible; key optional for local servers) |
| DELETE | `/auth/user/ai-provider/`        | Yes  | Remove the provider config                       |
| PUT    | `/auth/user/claude-api-key/`     | Yes  | Legacy compatibility route: set the Claude key (also writes the provider config) |
| DELETE | `/auth/user/claude-api-key/`     | Yes  | Legacy compatibility route: remove the Claude key |
| POST   | `/auth/user/update-email/`       | Yes  | Change email (requires password)                  |
| POST   | `/auth/user/update-password/`    | Yes  | Change password (requires current password), invalidates other tokens |
| GET    | `/auth/user/commentary-history/` | Yes  | List the user's saved reviews                     |
| DELETE | `/auth/user/delete/`             | Yes  | Delete the current account                        |
| GET    | `/api/health/`                   | No   | Health check                                      |
| POST   | `/api/commentary/`               | Yes  | Generate KataGo + LLM commentary from an SGF, synchronously |
| POST   | `/api/commentary/jobs/`          | Yes  | Queue a commentary run, returns a job id to poll (for clients that cannot hold a multi-minute request open, e.g. the extension) |
| GET    | `/api/commentary/jobs/{job_id}/` | Yes  | Poll a queued/running job's status, progress, and result |

Authenticated requests use the `Authorization: Bearer <access_token>` header. The
`CurrentUser` dependency (`deps.py`) validates the access JWT and loads the user.

The commentary request accepts `sgf_content`, `sgf_file_name`, `model` (any model
ID — OpenAI-compatible endpoints accept arbitrary names like `gpt-4o`,
`qwen2.5-7b`, or `llama3.1`; defaults to `claude-sonnet-5`), `language`
(`english` | `chinese (simplified)` | `japanese` | `korean`), `num_comments`
(1–100), `max_token` (256–8192), and an optional `custom_instruction` (≤1000 chars) —
see `GenerateCommentaryRequest` in `schemas.py`. The pipeline uses the account's
configured transport (see below); the per-run `model` is passed through to
whichever provider was selected.

## Admin dashboard

`main.py` mounts **SQLAdmin** at `/admin` with a session-based
`AuthenticationBackend` (`admin_auth.py`), but only when `ENABLE_ADMIN=true` — it is
off by default, so a deploy does not expose it by accident. Log in with
`ADMIN_USERNAME` / `ADMIN_PASSWORD`. `UserAdmin` hides the password hash and the
legacy encrypted API key from both the forms and the details view;
`AIProviderConfigAdmin` hides the encrypted key the same way; neither can edit or
delete rows. `CommentaryAdmin` lists saved reviews read-only. In production the
admin credentials must be changed from their dev defaults (enforced in
`config.py`).

## Authentication

- JWT **access token** (default 30 min) + **refresh token** (default 7 days), both
  HS256-signed with `SECRET_KEY`. Lifetimes are configurable via `config.py`.
- Passwords are hashed with bcrypt (`pwdlib`).
- AI provider credentials (Claude or OpenAI-compatible API keys) are encrypted with
  **Fernet** (`crypto.py`) using a key derived from `ENCRYPTION_KEY`; only ciphertext
  is stored, and the settings APIs never return it — plaintext or ciphertext.

## Commentary pipeline (`services/katago.py`)

1. **Fast pass** (`maxVisits=50`, no ownership/policy) across all turns to compute
   win-rate diffs and find the most impactful moves.
2. **Detailed pass** (`maxVisits=500`, with ownership + policy) on the selected worst
   moves and their preceding positions.
3. Builds rich prompts (ASCII board, KataGo stats, ownership map, principal variation)
   and calls the account's configured provider once per selected move.
4. Injects the commentary back into the SGF via sgfmill (`C[]` properties).

### Provider selection (`services/providers.py`)

Each account has one `AIProviderConfig` (see the settings endpoints above):

- **`claude`** — `ClaudeProvider` talks to Anthropic's Messages API with the account's
  key. This is also the **legacy fallback**: an account with no `AIProviderConfig` row
  (created before the table existed, or with only the old `User.claude_api` column)
  is served through Claude using that stored key, so nothing breaks mid-transition.
- **`openai-compatible`** — `OpenAICompatibleProvider` posts `{base_url}/chat/completions`
  with Bearer auth when a key exists (local servers may have none), `model`,
  `messages`, and `max_tokens`. The base URL defaults to `https://api.openai.com/v1`;
  vLLM and Ollama deployments pass their own endpoint. Response text and token usage
  are normalized onto the same shape Claude produces, and HTTP 401/403, 429, timeouts,
  connection errors, 5xx, and malformed responses are normalized into the stable
  commentary error categories (`upstream_auth_failed`, `upstream_rate_limited`,
  `upstream_error`). **Azure is not supported yet** — an `azure` config is rejected
  with `provider_unsupported` rather than being forced through the generic adapter
  (it needs deployment names, API versions, and different auth headers).
- Per-run failures leave a clearly-marked placeholder comment for that move while the
  rest of the run continues; usage is summed only over the calls that succeeded.

Each pass reaches the engine as several requests, not one. A proxy in front of the
analysis server gives up on the origin after a fixed window of its own (Cloudflare
answers `504` at around two minutes) while the work in a pass grows with the length of
the game, so turns are batched to a visit budget (`KATAGO_VISITS_PER_REQUEST`); a batch
that times out anyway is retried as two smaller ones, down to a single turn, and the
merged results are checked to cover exactly the turns that were asked for.

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
| `ENABLE_ADMIN`   | No            | `false` (default) or `true`. The `/admin` dashboard is not mounted at all unless this is set.                                            |
| `ADMIN_USERNAME` | Prod if enabled | SQLAdmin login. Must be non-default in production.                                                                                     |
| `ADMIN_PASSWORD` | Prod if enabled | SQLAdmin password. Must be non-default in production.                                                                                  |
| `DATABASE_URL`   | No            | Defaults to `sqlite:///./db.sqlite3`. Use a PostgreSQL URL in production.                                                                |
| `FRONTEND_URL`   | Prod          | Added to the CORS allowlist. `localhost:5173`/`127.0.0.1:5173` are allowed automatically outside production only — in production this is the *only* allowed origin, so the real frontend cannot reach the API without it set. |
| `API_TIMEOUT`    | No            | Seconds to wait for KataGo (default 120).                                                                                                |
| `KATAGO_VISITS_PER_REQUEST` | No | Visit budget per `/analyze` request — a pass is sent in batches of turns costing at most this much (default 1000). Lower it for a slower engine. |
| `COMMENTARY_PIPELINE_WORKERS` | No | Concurrent commentary pipelines on the dedicated executor (default 4).                                                        |
| `MAX_REQUEST_BODY_BYTES` | No    | Requests with a larger declared `Content-Length` are rejected before the body is read (default 5,000,000).                              |

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
| `test_auth_router.py`      | `/auth/*` — registration, tokens, settings, provider config + legacy Claude key, account management |
| `test_go_router.py`        | `/api/*` — commentary, error classification, provider-config wiring, the async job lifecycle |
| `test_katago_helpers.py`   | The pure helpers in `services/katago.py`, above all coordinate conversion |
| `test_katago_pipeline.py`  | `generate_commentary` end to end — KataGo, both Claude and OpenAI-compatible transports faked |

**No test touches a real service.** KataGo is served by `respx`, Anthropic by a stub
class that replaces `app.services.katago.Anthropic`, and the OpenAI-compatible
transport by `respx` too — so the suite needs neither an analysis server nor any real
provider credential.

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
