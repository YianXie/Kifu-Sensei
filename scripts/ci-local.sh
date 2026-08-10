#!/bin/bash
#
# Runs the same checks as .github/workflows/ci.yml, in the same order.
#
# Keep the two in step: a check added here without being added to the workflow
# does not gate anything, and one added there without being added here is only
# discovered after a push.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

FAILURES=()
SKIPPED=()

section() {
    echo ""
    echo -e "${BLUE}━━ $1 ${NC}"
}

# run <label> <working-dir> <command...>
#
# Records a failure and carries on rather than aborting, so one run reports
# every problem instead of only the first.
run() {
    local label="$1" directory="$2"
    shift 2
    echo -e "\n${DIM}\$ (${directory}) $*${NC}"
    if (cd "$directory" && "$@"); then
        echo -e "${GREEN}✓${NC} ${label}"
    else
        echo -e "${RED}✗${NC} ${label}"
        FAILURES+=("$label")
    fi
}

skip() {
    echo -e "${YELLOW}⚠${NC} $1"
    SKIPPED+=("$1")
}

echo "🚀 Running local CI checks..."

# ── Backend ───────────────────────────────────────────────────────────────────
section "Backend"

run "backend: install"      backend uv sync --dev --frozen
run "backend: ruff lint"    backend uv run ruff check .
run "backend: ruff format"  backend uv run ruff format --check .
run "backend: isort"        backend uv run isort --check-only --diff .
run "backend: pytest"       backend uv run pytest

# ── Frontend ──────────────────────────────────────────────────────────────────
section "Frontend"

run "frontend: install"     frontend npm ci
run "frontend: eslint"      frontend npm run lint
run "frontend: prettier"    frontend npm run format:check
run "frontend: vitest"      frontend npm test
run "frontend: build"       frontend npm run build

# ── Extension ─────────────────────────────────────────────────────────────────
section "Extension"

run "extension: install"    extension npm ci
run "extension: eslint"     extension npm run lint
run "extension: prettier"   extension npm run format:check
run "extension: vitest"     extension npm test

# `npm run build` regenerates extension/manifest.json in *production* form, which
# silently strips the localhost host permissions a `npm run build:dev` load-unpacked
# session depends on. Nothing about running the checks should break the extension a
# developer already has loaded in Chrome, so put back whatever was there.
MANIFEST="extension/manifest.json"
MANIFEST_BACKUP=""
if [ -f "$MANIFEST" ]; then
    MANIFEST_BACKUP="$(mktemp)"
    cp "$MANIFEST" "$MANIFEST_BACKUP"
fi

run "extension: build"      extension npm run build

if [ -n "$MANIFEST_BACKUP" ]; then
    if cmp -s "$MANIFEST_BACKUP" "$MANIFEST"; then
        rm -f "$MANIFEST_BACKUP"
    else
        mv "$MANIFEST_BACKUP" "$MANIFEST"
        echo -e "${DIM}  restored extension/manifest.json (the build had replaced it with the production one)${NC}"
    fi
fi

# ── Security ──────────────────────────────────────────────────────────────────
section "Security"

run "security: pip-audit"   backend uv run pip-audit --ignore-vuln CVE-2026-3219
run "security: bandit"      backend uv run bandit -c pyproject.toml -r .
run "security: npm audit (frontend)"  frontend  npm audit --audit-level=moderate
run "security: npm audit (extension)" extension npm audit --audit-level=moderate

if command -v gitleaks >/dev/null 2>&1; then
    # `git` rather than `dir`: scanning the working tree would flag the
    # developer's own untracked backend/.env, which is not in the repository.
    run "security: gitleaks" . gitleaks git . --no-banner --redact --verbose
else
    skip "security: gitleaks not installed — CI will still run it (brew install gitleaks)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
for note in "${SKIPPED[@]:-}"; do
    [ -n "$note" ] && echo -e "${YELLOW}⚠ skipped:${NC} $note"
done

if [ ${#FAILURES[@]} -eq 0 ]; then
    echo -e "${GREEN}🎉 All CI checks passed!${NC}"
    echo "Your code is ready to be pushed to the repository."
    exit 0
fi

echo -e "${RED}${#FAILURES[@]} check(s) failed:${NC}"
for failure in "${FAILURES[@]}"; do
    echo -e "  ${RED}✗${NC} $failure"
done
echo ""
echo "Formatting problems are usually fixed by: make format"
exit 1
