# Kifu Sensei

**The first Go game review tool with move-by-move natural-language commentary.**

Every existing AI review tool — AI Sensei, KaTrain, OGS, ZBaduk — shows you that your move lost 8 points. None of them tell you *why*. Kifu Sensei bridges that gap: it combines KataGo's superhuman analysis with Claude to produce plain-English commentary targeted at SDK–DDK players, grounded entirely in the board data rather than invented tactical justifications.

The closest analogue in another game is Chess.com's Diamond Coach. Nothing equivalent exists for Go.

---

## How It Works

1. Upload an `.sgf` file.
2. KataGo runs a fast first pass across every move to find the 20 most impactful positions (by win-rate swing).
3. A detailed second pass on those positions computes ownership maps, policy priors, and 15-move principal variations.
4. Claude receives a structured prompt for each position — ASCII board with the played move and KataGo's top suggestion marked, win-rate before/after, score lead, ownership summary — and writes 3–4 sentences of commentary.
5. The commentary is injected back into the SGF and offered as a download. You can also step through the game interactively in the browser.

LLM cost per game review is well under $0.10 with prompt caching. You supply your own Claude API key; it is encrypted with Fernet and never stored in plaintext.

---

## Features

- **Natural-language commentary** grounded in KataGo data — win-rate, score lead, policy prior, ownership map, principal variation
- **Focuses on key mistakes** — analyses the 20 biggest turning points, not every move
- **Interactive board viewer** — step through moves, jump directly to commented turns
- **Annotated SGF download** — comments embedded as `C[]` properties, viewable in any SGF editor (Sabaki, KaTrain, etc.)
- **Bring your own Claude API key** — stored encrypted at rest; no key is shared across users

---

## Tech Stack

| Layer | Technology |
|---|---|
| Analysis engine | KataGo (self-hosted HTTP API) |
| Commentary | Claude (`claude-haiku-4-5`) via Anthropic API |
| Backend | FastAPI, SQLModel, SQLite/PostgreSQL, JWT auth, Fernet encryption |
| Frontend | React 18, TypeScript, Vite, MUI, `@sabaki/go-board` |
| Package management | `uv` (backend), `npm` (frontend) |

---

## Getting Started

### Prerequisites

- Python ≥ 3.12 and [`uv`](https://github.com/astral-sh/uv)
- Node.js ≥ 18
- A running KataGo analysis HTTP server (see [KataGo docs](https://github.com/lightvector/KataGo))
- A Claude API key (obtainable from [console.anthropic.com](https://console.anthropic.com))

### Install

```bash
make install
```

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

---

## Deployment

See [`deploy.md`](./deploy.md) for a step-by-step guide to deploying the backend on Render with PostgreSQL.
