.PHONY: install install-backend install-frontend \
        run run-backend run-frontend \
        lint format test ci

# ── Install ────────────────────────────────────────────────────────────────────
install: install-backend install-frontend

install-backend:
	cd backend && uv sync

install-frontend:
	cd frontend && npm install

# ── Dev servers ───────────────────────────────────────────────────────────────
run-backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

run-frontend:
	cd frontend && npm run dev

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	cd backend && uv run ruff check .
	cd frontend && npm run lint

format:
	cd backend && uv run ruff format . && uv run isort .
	cd frontend && npm run format

test:
	cd backend && uv run pytest

# ── CI (lint + format check + test) ──────────────────────────────────────────
ci:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
	cd frontend && npm run lint && npm run build
