# Kifu Sensei Backend

FastAPI backend for Kifu Sensei. Provides JWT authentication, user settings, and
SGF → KataGo game-commentary generation.

## Stack

- **FastAPI** (ASGI, served by Uvicorn)
- **SQLModel** (SQLAlchemy + Pydantic) over SQLite
- **PyJWT** for access/refresh JWTs
- **pwdlib** (bcrypt) for password hashing
- **httpx** + **sgfmill** for KataGo analysis

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

The database (`db.sqlite3`) and its tables are created automatically on startup.
Interactive API docs are available at `http://localhost:8000/docs`.

## Endpoints

| Method | Path                          | Auth | Description                         |
| ------ | ----------------------------- | ---- | ----------------------------------- |
| POST   | `/auth/register/`             | No   | Create an account                   |
| POST   | `/auth/token/`                | No   | Log in → `{access, refresh, user}`  |
| POST   | `/auth/token/refresh/`        | No   | Exchange a refresh token for tokens |
| GET    | `/auth/user/settings/`        | Yes  | Read user preferences               |
| PUT    | `/auth/user/settings/`        | Yes  | Update user preferences             |
| POST   | `/auth/user/update-email/`    | Yes  | Change email (requires password)    |
| POST   | `/auth/user/update-password/` | Yes  | Change password                     |
| DELETE | `/auth/user/delete/`          | Yes  | Delete the current account          |
| GET    | `/api/health/`                | No   | Health check                        |
| POST   | `/api/commentary/`            | Yes  | Generate KataGo commentary from SGF |

Authenticated requests use the `Authorization: Bearer <access_token>` header.
