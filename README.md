# Kifu-Sensei

**The first Go game review tool with move-by-move natural-language commentary.**

Every existing AI review tool — AI Sensei, KaTrain, OGS, ZBaduk — shows you that your move lost 8 points. None of them tell you _why_. Kifu-Sensei bridges that gap: it combines KataGo's superhuman analysis with Claude to produce plain-English commentary targeted at SDK–DDK players, grounded entirely in the board data rather than invented tactical justifications.

The closest analogue in another game is Chess.com's Diamond Coach. Nothing equivalent exists for Go.

---

## Components

Kifu-Sensei is a monorepo with three top-level components, all talking to the same backend API:

| Component     | Directory    | What it is                                                                                         | Status                  |
| ------------- | ------------ | -------------------------------------------------------------------------------------------------- | ----------------------- |
| **Backend**   | `backend/`   | FastAPI service: JWT auth, encrypted API-key storage, and the KataGo → Claude commentary pipeline. | Active                  |
| **Frontend**  | `frontend/`  | React web app: upload an SGF, view the board, read/download commentary, manage your account.        | Active                  |
| **Extension** | `extension/` | Manifest V3 Chrome side-panel extension that overlays commentary on online-go.com games.           | ⚠️ **Work in progress** |

> ⚠️ **The browser extension is a work in progress and is NOT ready for production use.** The authentication handoff between the web app and the extension works, but the in-panel commentary generation flow is still being built out. Load it unpacked for development only. See [`extension/README.md`](./extension/README.md) for details.

Each component has its own README with an in-depth walkthrough:

- [`backend/README.md`](./backend/README.md) — API reference, architecture, environment variables
- [`frontend/README.md`](./frontend/README.md) — React structure, the design system, routing, auth
- [`extension/README.md`](./extension/README.md) — file structure, the four-context auth handoff, and the roadmap

---

## How It Works

1. Upload an `.sgf` file (web app) — or open a finished game on online-go.com (extension, WIP).
2. KataGo runs a fast first pass across every move to find the most impactful positions (by win-rate swing).
3. A detailed second pass on those positions computes ownership maps, policy priors, and multi-move principal variations.
4. Claude receives a structured prompt for each position — ASCII board with the played move and KataGo's top suggestion marked, win-rate before/after, score lead, ownership summary — and writes a few sentences of commentary.
5. The commentary is injected back into the SGF and offered as a download. You can also step through the game interactively in the browser, and revisit past reviews from your history.

LLM cost per game review is well under $0.10 with prompt caching. You supply your own Claude API key; it is encrypted with Fernet and never stored in plaintext.

---

## Features

- **Natural-language commentary** grounded in KataGo data — win-rate, score lead, policy prior, ownership map, principal variation
- **Focuses on key mistakes** — analyses the biggest turning points, not every move (configurable, default 20)
- **Interactive board viewer** — step through moves, jump directly to commented turns
- **Annotated SGF download** — comments embedded as `C[]` properties, viewable in any SGF editor (Sabaki, KaTrain, etc.)
- **Commentary history** — past reviews are saved and can be reopened
- **Configurable reviews** — choose the Claude model, output language, number of comments, token budget, and custom instructions
- **Bring your own Claude API key** — stored encrypted at rest; no key is shared across users

---

## Tech Stack

| Layer              | Technology                                                                         |
| ------------------ | ---------------------------------------------------------------------------------- |
| Analysis engine    | KataGo (self-hosted HTTP API)                                                      |
| Commentary         | Claude (`claude-sonnet-5` by default; Fable/Opus/Haiku selectable) via Anthropic   |
| Backend            | FastAPI, SQLModel, SQLite/PostgreSQL, JWT auth, Fernet encryption, SQLAdmin        |
| Frontend           | React 19, TypeScript, Vite, the Kifu-Sensei design system, `@sabaki/go-board`      |
| Extension          | Manifest V3, TypeScript, Vite (no UI framework)                                    |
| Package management | `uv` (backend), `npm` (frontend & extension)                                       |

---

## Getting Started

### Prerequisites

- Python ≥ 3.12 and [`uv`](https://github.com/astral-sh/uv)
- Node.js ≥ 18
- A running KataGo analysis HTTP server (see [KataGo docs](https://github.com/lightvector/KataGo))
- A Claude API key (obtainable from [console.anthropic.com](https://console.anthropic.com))

### Install

```bash
make install   # installs backend (uv sync --dev), frontend, and extension
```

To load the extension in Chrome you still need `cd extension && npm run build` — see
[`extension/README.md`](./extension/README.md).

### Configure

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set API_ENDPOINT to your KataGo server URL

# Frontend
cp frontend/.env.example frontend/.env
# Edit frontend/.env — set VITE_API_URL=http://localhost:8000
```

### Run

```bash
make run-backend   # FastAPI on :8000
make run-frontend  # Vite dev server on :5173
```

Open `http://localhost:5173`, register an account, add your Claude API key under Settings, then upload an SGF.

### Test, lint, format, and CI

```bash
make test     # pytest (backend), vitest (frontend, extension)
make lint     # ruff + isort (backend), eslint + prettier (frontend, extension) — read-only
make format   # rewrites files to satisfy the formatters
make build    # tsc + vite build (frontend, extension)
make security # pip-audit + bandit (backend), npm audit (frontend, extension)
make ci       # everything above, in one run, the same as GitHub Actions
```

Each target has `-backend`, `-frontend`, and `-extension` variants — `make test-backend`,
`make lint-extension`, and so on.

`make ci` runs `scripts/ci-local.sh`, which mirrors `.github/workflows/ci.yml`: per-component
lint, format check, tests and build, plus a dependency audit and a gitleaks scan of the commit
history. It runs every check even after one fails and prints a summary at the end. Install
gitleaks (`brew install gitleaks`) to include the secret scan locally; without it the step is
skipped with a warning and CI still runs it.

No test contacts a real service. The backend suite serves KataGo through `respx` and stubs the
Anthropic client, so `make test` needs neither an analysis server nor a Claude API key.

---

## Deployment

All three services are deployed on **Render** (frontend, backend, and a PostgreSQL database). In production the backend requires `SECRET_KEY`, `ENCRYPTION_KEY`, and admin credentials to be set to non-default values — see [`backend/README.md`](./backend/README.md) for the full environment-variable reference.

---

## License

See [`LICENSE`](./LICENSE).
