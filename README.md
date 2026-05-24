# website-template

A production-ready full-stack starter: **Django REST Framework** backend + **React + TypeScript** frontend.

Modelled after [LucidGo](../LucidGo) — same conventions, tooling, and patterns.

---

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12, Django 5.2, DRF 3.16, SimpleJWT |
| Database | SQLite (dev) / PostgreSQL (prod via `dj-database-url`) |
| Frontend | React 18, TypeScript, Vite 6, MUI 6, Tailwind CSS 4 |
| Auth | JWT (access 30min / refresh 7d, blacklist on rotation) |
| HTTP client | Axios with auto-refresh interceptor + request queue |
| Styling | MUI `sx` prop + Tailwind utility classes (hybrid) |
| Linting | ruff + isort (backend), ESLint + Prettier (frontend) |

---

## Project structure

```
website-template/
├── backend/
│   ├── api/            # Generic Item CRUD app — rename for your domain
│   ├── users/          # Auth: register, JWT login, settings, profile
│   ├── backend/        # Django settings, root URLs, wsgi/asgi
│   ├── manage.py
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/ # Layout, NavSidebar, ProtectedRoute
│   │   ├── contexts/   # AuthContext (global auth + settings state)
│   │   ├── hooks/      # usePageTitle, useRedirectIfAuthenticated
│   │   ├── pages/      # Home, Login, Register, Dashboard, Settings, Profile
│   │   ├── types/      # TypeScript interfaces
│   │   ├── utils/      # errorFormatting
│   │   ├── api.ts      # Axios instance with auto-refresh
│   │   └── constants.ts
│   ├── package.json
│   └── vite.config.ts
└── Makefile
```

---

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env          # fill in values
uv sync                       # install deps
uv run python manage.py migrate
uv run python manage.py runserver
```

Backend runs at `http://localhost:8000`.

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local    # fill in values
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

Or use `make install && make migrate` then open two terminals with `make run-backend` / `make run-frontend`.

---

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register/` | — | Create account |
| POST | `/auth/token/` | — | Login → JWT pair |
| POST | `/auth/token/refresh/` | — | Refresh access token |
| GET/PUT | `/auth/user/settings/` | ✓ | Get/update preferences |
| POST | `/auth/user/update-email/` | ✓ | Change email |
| POST | `/auth/user/update-password/` | ✓ | Change password |
| DELETE | `/auth/user/delete/` | ✓ | Delete account |
| GET | `/api/health/` | — | Health check |
| GET/POST | `/api/items/` | ✓ | List / create items |
| GET/PATCH/DELETE | `/api/items/<uuid>/` | ✓ | Item detail |

---

## Customising for your project

1. **Rename the `api` app** — replace `Item` with your domain model in `api/models.py`, `api/serializers.py`, `api/views.py`, `api/urls.py`.
2. **Add user preferences fields** — extend `DEFAULT_USER_PREFERENCES` in `users/models.py` and update `Settings.tsx`.
3. **Add pages** — create a file in `frontend/src/pages/` and add a `<Route>` in `App.tsx`.
4. **Deploy** — set `ENVIRONMENT=production`, `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOST`, `FRONTEND_URL` in backend `.env`; set `VITE_API_URL` in frontend `.env.local`.
