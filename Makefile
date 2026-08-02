.PHONY: install install-backend install-frontend install-extension \
        run-backend run-frontend \
        format format-backend format-frontend format-extension \
        lint lint-backend lint-frontend lint-extension \
        test test-backend test-frontend test-extension \
        build build-frontend build-extension \
        security ci

# ── Install ────────────────────────────────────────────────────────────────────
install: install-backend install-frontend install-extension

install-backend:
	cd backend && uv sync --dev

install-frontend:
	cd frontend && npm install

install-extension:
	cd extension && npm install

# ── Dev servers ───────────────────────────────────────────────────────────────
run-backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

run-frontend:
	cd frontend && npm run dev

# ── Format (writes) ───────────────────────────────────────────────────────────
format: format-backend format-frontend format-extension

format-backend:
	cd backend && uv run ruff format . && uv run isort .

format-frontend:
	cd frontend && npm run format

format-extension:
	cd extension && npm run format

# ── Lint + format check (read-only) ───────────────────────────────────────────
lint: lint-backend lint-frontend lint-extension

lint-backend:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run isort --check-only --diff .

lint-frontend:
	cd frontend && npm run lint && npm run format:check

lint-extension:
	cd extension && npm run lint && npm run format:check

# ── Tests ─────────────────────────────────────────────────────────────────────
test: test-backend test-frontend test-extension

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npm test

test-extension:
	cd extension && npm test

# ── Build (type-checks too: both scripts start with tsc) ──────────────────────
build: build-frontend build-extension

build-frontend:
	cd frontend && npm run build

build-extension:
	cd extension && npm run build

# ── Security ──────────────────────────────────────────────────────────────────
security:
	cd backend && uv run pip-audit --ignore-vuln CVE-2026-3219
	cd backend && uv run bandit -c pyproject.toml -r .
	cd frontend && npm audit --audit-level=moderate
	cd extension && npm audit --audit-level=moderate

# ── Everything CI runs ────────────────────────────────────────────────────────
ci:
	@./scripts/ci-local.sh
