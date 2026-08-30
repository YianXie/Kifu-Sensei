#!/usr/bin/env bash
#
# Cloud Agent environment bootstrap for Kifu-Sensei.
#
# Idempotent: safe to re-run against a cached or partially prepared checkout.
# Installs uv (the backend package manager), writes development .env files using
# development defaults only (no secrets — the dev-default SECRET_KEY/ENCRYPTION_KEY
# in app/config.py are accepted outside production, and API_ENDPOINT is the one
# required value), then installs every component's dependencies via `make install`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# uv is not in Cursor's default image; the official installer drops it in
# ~/.local/bin. Skip when it is already on PATH so re-runs stay fast.
if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# The backend refuses to start unless API_ENDPOINT is set (app/config.py). Point it
# at the local KataGo port; the engine is only contacted when a commentary run is
# actually requested, so the server, auth, and the whole web app run without it.
if [ ! -f backend/.env ]; then
    cat > backend/.env <<'EOF'
ENVIRONMENT=development
DATABASE_URL=sqlite:///./db.sqlite3
API_ENDPOINT=http://localhost:8001
EOF
fi

if [ ! -f frontend/.env ]; then
    cat > frontend/.env <<'EOF'
VITE_ENVIRONMENT=development
VITE_API_URL=http://localhost:8000
EOF
fi

make install
