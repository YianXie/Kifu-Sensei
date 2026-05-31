.PHONY: install install-backend install-frontend \
        run run-backend run-frontend \
        format ci

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

format:
	cd backend && uv run ruff format . && uv run isort .
	cd frontend && npm run format

# ── CI (lint + format check + test) ──────────────────────────────────────────
ci:
	@./scripts/ci-local.sh
