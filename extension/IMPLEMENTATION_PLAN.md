# Finish the Kifu-Sensei Browser Extension — Implementation Plan

> Status: approved, not yet started. Paths in this document are relative to `extension/`.

## Context

The extension's auth handoff works end to end, but the commentary flow does not exist: `screen-api-key`, `screen-generating`, `screen-commentary`, `screen-error`, and `screen-waiting` in [panel/panel.html](panel/panel.html) are static scaffolding, and nothing detects an OGS game or calls the backend. The goal is a one-click path from a finished online-go.com game to move-by-move commentary in the side panel.

Investigation turned up four blockers that cannot be solved in extension code, all confirmed rather than assumed:

1. **Three of four selectable Claude models are invalid IDs.** `claude-fable-5-0` / `claude-opus-5-0` / `claude-sonnet-5-0` carry a spurious `-0`; the real IDs are `claude-fable-5` / `claude-opus-5` / `claude-sonnet-5`. [../backend/app/services/katago.py](../backend/app/services/katago.py) passes `model` straight to `client.messages.create()`, and [../backend/app/schemas.py](../backend/app/schemas.py) **defaults to the broken** `claude-sonnet-5-0` — so the default path 404s at Anthropic today, for the web app as much as the extension.
2. **MV3 service workers die on long fetches.** Chrome terminates an extension service worker "when a `fetch()` response takes more than 30 seconds to arrive". A multi-minute `POST /api/commentary/` therefore cannot be owned by the worker, which rules out the naive "worker owns the request, panel is a view" design.
3. **The backend collapses every failure into one error.** [../backend/app/routers/go.py](../backend/app/routers/go.py) wraps the whole pipeline in `except Exception` → HTTP 400 `"Failed to generate commentary: {exc}"`. No-API-key, Anthropic 429, and KataGo-down are indistinguishable to any client.
4. **The model list is already in sync.** Backend and frontend agree exactly (commit `b81cb75`). The real drift is the invalid IDs above plus a three-way _default_ mismatch — [../backend/app/models.py](../backend/app/models.py) says haiku, while the Pydantic and frontend defaults say sonnet.

Phase 0 fixes all four in `backend/` + `frontend/`. Phases 1–5 build the extension on top.

---

## 1. Open questions and assumptions

### Confirmed by investigation (not assumed)

| Fact | How verified |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| SGF endpoint is `GET https://online-go.com/api/v1/games/{id}/sgf`, `application/x-go-sgf`, **no auth** for finished games | Fetched games `1234567` and `65097807` |
| In-progress games return **HTTP 403** `"Sign in to download SGF of in-progress games"` | Probed live game `88869862` |
| `GET /api/v1/games/{id}` returns `gamedata.phase` ∈ `"play"                                                                                                                                                               | "stone removal"                                | "finished"`and top-level`ended` (null while playing) | Same probes + `GobanEnginePhase` in `online-go/goban` |
| OGS theme is `document.documentElement.dataset.theme` ∈ `light                                                                                                                                                            | dark                                           | accessible` (`system`resolves at runtime via`matchMedia`) | `applyTheme()` in OGS `src/main.tsx`; confirmed `<html data-theme="light">` on a live page |
| No `<footer>` on the game page. Real tree: `.Game > .right-col > .PlayControls > [.game-action-buttons, .game-state, .annulled-indicator, .analyze-mode-buttons]`; `.game-action-buttons` is **empty** on a finished game | Read the live DOM |
| OGS routes: `/game/:id`, `/game/view/:id`, `/game/:id/:move_number` (plus `/review/*`, `/demo/*` — not games) | OGS `src/routes.tsx` |
| Handicap SGFs use `HA[4]` + `AB[...]` with **White moving first** | Fetched game `65097807` |
| MV3 SW termination: 30 s idle, **30 s fetch-response cap**, 5 min single-request cap | Chrome extension service-worker lifecycle docs |

### Assumptions

| #   | Assumption                                                                                                                                                                                                                                                | Risk if wrong                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A1  | `design/all-button-states.png` **does not exist** — absent from the working tree, from `git log --all --diff-filter=A`, and from the stale `design-sync/kifu-sensei-ds` branch. Injected-button styling is derived from `panel.css` tokens instead.       | Cosmetic rework of one component in Phase 5.                                                                     |
| A2  | Backend runs as a **single Render instance**, so a DB-backed job row plus `BackgroundTasks` is sufficient.                                                                                                                                                | Multi-instance needs a real queue; the DB-row design already survives it, only the in-process runner would move. |
| A3  | `chrome.alarms` minimum `periodInMinutes` is **1**. Some Chrome versions allow `0.5`; do not rely on that without verifying at implementation time.                                                                                                       | Slower worst-case resurrection after SW death. Not a correctness issue — the panel polls at 3 s while open.      |
| A4  | Users' saved `preferences.commentary_config.model` may hold a stale `-0` ID. `readCommentaryConfig` already validates against the allowed list and falls back, so this **self-heals with no data migration**; the extension must run the same validation. | A raw pass-through of the saved preference would 400 on the Pydantic `Literal`. Mitigated by design.             |
| A5  | `retry_after` for Anthropic 429s comes from the `retry-after` response header on `anthropic.RateLimitError`; absent → omit rather than invent a number.                                                                                                   | Panel shows "try again shortly" instead of a countdown.                                                          |

### Deliberate non-goals

- **No prompt caching.** The system prompt is ~200 tokens; Haiku 4.5's minimum cacheable prefix is 4096 tokens, so `cache_control` would silently never cache. Usage fields are still aggregated for forward-compat and will read `0`.
- **No board overlay** on the OGS page (roadmap item, not in this brief).
- [tsconfig.json](tsconfig.json) has **no** `"strict": true`. New code will be written to pass strict, but flipping the flag would churn existing files — out of scope.

---

## 2. Phase 0 — backend + frontend changes

Five independently reviewable commits. Phase 0.5 is the only one the extension strictly requires; 0.1–0.4 are bug fixes that stand on their own merit.

### 0.1 — Correct the Claude model IDs

Drop the `-0` suffix everywhere and settle the default on `claude-sonnet-5`.

```diff
# backend/app/schemas.py — GenerateCommentaryRequest
-    model: Literal[
-        "claude-fable-5-0", "claude-opus-5-0", "claude-sonnet-5-0", "claude-haiku-4-5"
-    ] = "claude-sonnet-5-0"
+    model: Literal[
+        "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"
+    ] = "claude-sonnet-5"
```

| File                                                                                                                     | Change                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [../backend/app/schemas.py](../backend/app/schemas.py)                                                                   | `Literal` + default as above                                                                                          |
| [../backend/app/models.py](../backend/app/models.py)                                                                     | `DEFAULT_USER_PREFERENCES["commentary_config"]["model"]` → `"claude-sonnet-5"` (resolves the three-way default drift) |
| [../backend/app/services/katago.py](../backend/app/services/katago.py)                                                   | `_CLAUDE_MODEL = "claude-sonnet-5"`                                                                                   |
| [../frontend/src/types/commentary.ts](../frontend/src/types/commentary.ts)                                               | `ClaudeModel` union, `CLAUDE_MODELS`, `DEFAULT_COMMENTARY_CONFIG.model`                                               |
| [../frontend/src/components/commentary/CommentaryConfig.tsx](../frontend/src/components/commentary/CommentaryConfig.tsx) | Four `<MenuItem value=…>`                                                                                             |
| `../README.md`, `../backend/README.md`                                                                                   | Model tables touched by `b81cb75`                                                                                     |

No DB migration: stale preference values are corrected in-memory by the existing `readCommentaryConfig` fallback (assumption A4).

### 0.2 — Per-comment win-rate delta and colour

> **Implemented, with two changes from the original plan — see the notes at the end of this section.**

The win-rate change is already computed twice in the pipeline: coarsely in `winrate_diff` (first pass, 50 visits, used for move selection) and again inside `_generate_user_prompt` as the `[CHANGE: ...]` figure shown to the model (detailed pass, 500 visits). The badge uses the **detailed** one.

```diff
# backend/app/schemas.py
 class CommentaryItemSchema(BaseModel):
     turn: int
     comment: str
+    winrate_delta: float | None = None   # percentage points, mover's perspective; negative = lost win rate
+    color: Literal["B", "W"] | None = None
```

A shared `_mover_winrate_delta(detail, prev_detail)` helper in `katago.py` computes the value, and `generate_commentary` emits it per comment:

```python
for i, detail in enumerate(detailed_results):
    turn = detail["turnNumber"]
    comments.append({
        "turn": turn,
        "comment": comment_texts[i],
        "winrate_delta": _mover_winrate_delta(detail, detailed_prev_results[i]),
        "color": moves[turn - 1][0],          # 1-based turn → 0-based moves index
    })
```

**Why** `color` **when the client can derive it:** it makes each comment self-describing for consumers that render a comment list without the board (History cards, the annotated-SGF export, future report output). The extension still derives from `moves[turn - 1][0]`, using `item.color` only as a fallback for History rows written before this change.

**Severity tiering belongs on the client.** The tier is a pure function of the delta and a pure _display_ concern; the `.card--blunder` / `--mistake` / `--notable` classes already live in [panel/panel.css](panel/panel.css). Putting thresholds on the server would freeze them into the API and into every stored History row, so tuning them later would need a schema change plus a backfill. Client-side, the extension and web app can also diverge (e.g. a future user-configurable sensitivity) without touching the backend.

Thresholds: `delta <= -10` → blunder, `delta <= -5` → mistake, else notable.

**No migration.** `Commentary.comments` is `Column(JSON, nullable=False)` holding a list of arbitrary dicts — extra keys need no DDL.

#### Changes from the original plan

1. **The delta comes from the detailed pass, not `winrate_diff`.** `winrate_diff` is computed at 50 visits; the number the model is shown when it writes the comment comes from the 500-visit pass. Using the first-pass value would let the badge say `−18%` while the comment text reasons about a different figure. Both were already in scope at the point the comments list is built, so the accurate one is free. Extracted as `_mover_winrate_delta` so the badge and the prompt cannot drift apart.
2. **Both fields are optional on the backend schema, not just the frontend.** `GET /auth/user/commentary-history/` replays stored rows through this same `GenerateCommentaryResponse`, so required fields raise `ValidationError` on every commentary saved before this change — a 500 on the History page for existing users. `None` rather than `0.0`, so "unknown" is not mistaken for "a genuinely neutral move". Fresh generations always populate both; clients can still recover `color` from `moves[turn - 1][0]`, which old rows do have.

Verified: turn parity is wrong on **every** move of OGS game `65097807` — the four handicap stones land in `initialStones`, so `moves[0]` is White and the inversion holds for the whole game.

### 0.3 — Token usage and model name

> **Implemented.** One change from the original plan — `model` is optional, see the note at the end of this section.

```diff
+class CommentaryUsageSchema(BaseModel):
+    input_tokens: int = 0
+    output_tokens: int = 0
+    cache_read_input_tokens: int = 0
+    cache_creation_input_tokens: int = 0
+
 class GenerateCommentaryResponse(BaseModel):
     board_size: int
     sgf_file_name: str
     language: Literal[...]
+    model: str | None = None
+    usage: CommentaryUsageSchema | None = None
     moves: list[list]
     ...
```

`generate_commentary_with_claude` now returns `tuple[list[str], dict[str, int]]`, accumulating token counts through `_accumulate_usage` across the per-move calls. A plain dict rather than the Pydantic model, so it drops straight into the `usage` JSON column without a `model_dump()` step. Cache fields stay `0` — see non-goals. `_accumulate_usage` uses `getattr(..., 0) or 0` so both a `None` cache counter (today) and an SDK build that omits the attribute entirely are handled.

Also folded in here: [../backend/app/services/katago.py](../backend/app/services/katago.py) formatted the win rate in the model's prompt as `{winrate:+1f}` — a min-width spec, not a precision one — so Claude was shown `+42.300000%` instead of `+42.3%`. Corrected to `{winrate:+.1f}`.

**Migration required** (persistence for the History page and the panel footer):

- `backend/alembic/versions/<rev>_add_commentary_model_and_usage.py`, `down_revision = "09675a91ba0d"` (current head; chain is `8b64b9877cb2` → `09675a91ba0d`).
- `op.add_column("commentaries", sa.Column("model", sa.String(), nullable=True))`
- `op.add_column("commentaries", sa.Column("usage", sa.JSON(), nullable=True))`
- Both nullable so existing rows stay valid. `env.py` already sets `target_metadata = SQLModel.metadata` and imports `app.models`, so autogenerate works.

Landed as `b45c00e4f9e6`, wrapped in `op.batch_alter_table` (SQLite cannot `ALTER` in place; a no-op wrapper on PostgreSQL). Autogenerate emits `typing.Union` / `typing.Sequence`, which the repo's `ruff` `UP` rules reject — the file was rewritten in the style of the existing migrations. Verified by downgrade → re-upgrade on a copy with rows present: no data loss.

#### Change from the original plan

**`model` is `str | None`, not `str`** — same reason as the 0.2 fields. `get_commentary_history` replays rows through this schema, and rows predating the migration have `model IS NULL`; a required field 500s the History page for every one of them. Verified against a real pre-migration row seeded into a local database: both it and a modern row now replay through `UserCommentaryHistory` without error.

### 0.4 — Error taxonomy in the commentary router

> **Implemented.** Three changes from the original plan — see the notes at the end of this section.

The single `except Exception` is replaced by an ordered chain. Each failure mode is a `CommentaryError` subclass in [../backend/app/errors.py](../backend/app/errors.py) carrying its own status and `code`; a handler registered alongside the existing `FieldValidationError` one renders the flat body and sets the `Retry-After` header.

```diff
+class CommentaryErrorResponse(BaseModel):
+    detail: str
+    code: Literal["no_api_key", "invalid_sgf", "upstream_rate_limited",
+                  "upstream_auth_failed", "upstream_error",
+                  "katago_unavailable", "internal_error"]
+    retry_after: int | None = None
```

| Trigger                                                           | Status | `code`                  |
| ----------------------------------------------------------------- | ------ | ----------------------- |
| `MissingApiKeyError`                                              | 409    | `no_api_key`            |
| `InvalidSgfError` (raised at the two `sgfmill` parse sites)       | 400    | `invalid_sgf`           |
| `anthropic.RateLimitError` (reads the `retry-after` header)       | 429    | `upstream_rate_limited` |
| `anthropic.AuthenticationError` / `PermissionDeniedError`         | 502    | `upstream_auth_failed`  |
| `anthropic.APIError` (base class — must stay below the two above) | 502    | `upstream_error`        |
| `httpx.HTTPError` (KataGo; covers timeouts and 5xx)               | 502    | `katago_unavailable`    |
| anything else                                                     | 500    | `internal_error`        |

Frontend knock-on: `Commentary.tsx` maps `code` through a new `getCommentaryError` in [../frontend/src/utils/errorFormatting.ts](../frontend/src/utils/errorFormatting.ts), which falls back to the existing `getErrorMessage` for untagged failures (a network error never reaches the server, so it carries no code). `no_api_key` also routes to `/setup-api-key`.

#### Changes from the original plan

1. **`invalid_sgf` is a typed exception raised at the parse sites, not a `ValueError` caught in the router.** `katago.py`'s coordinate helpers raise `ValueError` too, and those are bugs, not malformed input — catching `ValueError` in the router would report them to the user as "your SGF is broken" and hide a real defect.
2. **Added `upstream_error` (502).** `anthropic.APIError` is the base class; without a catch for it, an Anthropic outage or connection failure fell through to `internal_error` (500), blaming Kifu-Sensei for someone else's downtime.
3. **The API-key check moved to the top of `generate_commentary`.** It previously lived only in `generate_commentary_with_claude`, which runs _after_ both KataGo passes — so a user with no key waited out the entire multi-minute analysis before being told. Measured: **409 in 5 ms** against the real pipeline, versus a full KataGo run before. The check stays in `generate_commentary_with_claude` as well, since that function is callable on its own.

Two behaviours worth knowing beyond the taxonomy itself:

- **A history-write failure no longer discards the commentary.** Persistence moved out of the generation `try` into its own block that logs and rolls back. The run has already cost KataGo time and Anthropic tokens; losing it to a database hiccup is the worse outcome.
- `retry_after` is echoed in the body _and_ set as the `Retry-After` header, so browser clients can read it without needing the header CORS-exposed.

Verified end to end through `TestClient` — 10 scenarios (including a 429 with and without the header, three distinct KataGo failure shapes, and an unexpected `RuntimeError`) each produce the intended status, code, and `retry_after`, with the body carrying exactly `{detail, code, retry_after}`.

### 0.5 — Async job API (additive; does not change the existing endpoint)

> **Implemented as planned.** Migration `ba4d65f3c049`. Implementation notes at the end of this section.

`POST /api/commentary/` stays synchronous so the web app is untouched. Two new endpoints:

| Endpoint | Behaviour |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------ | ------ |
| `POST /api/commentary/jobs/` | Same `GenerateCommentaryRequest` body → **202** `{job_id, status: "queued"}` |
| `GET /api/commentary/jobs/{job_id}/` | `{status, progress: {done, total}, result: GenerateCommentaryResponse        | null, error: CommentaryErrorResponse | null}` |

New `CommentaryJob` SQLModel table (fold into the 0.3 migration or add a second one):

```
id: str (uuid4, PK) | user_id: int FK users.id | status: str (queued|running|succeeded|failed)
progress_done: int  | progress_total: int      | result: JSON | null
error_code: str|null| error_detail: str|null   | retry_after: int|null
created_at, updated_at: datetime
```

- **Runner:** FastAPI `BackgroundTasks`. `generate_commentary` is fully synchronous (`httpx.Client` + the sync Anthropic client), so a sync background function runs in Starlette's threadpool without blocking the event loop.
- **Progress:** give `generate_commentary` an optional `on_progress: Callable[[int, int], None]` invoked after each Claude call; the router's callback writes `progress_done` / `progress_total`. This is what makes the panel's progress bar honest rather than a mock.
- `GET` enforces `job.user_id == user.id`, returning 404 otherwise — do not leak existence.
- **Retention:** on create, delete this user's jobs older than 24 h.

#### Implementation notes

- **The error mapping is shared, not duplicated.** 0.4's `except` chain became `_to_commentary_error(exc) -> CommentaryError`, used by both the synchronous endpoint and the job runner, so a failure classifies identically whichever way it was submitted.
- **The runner owns its own session and re-loads the user by id.** The request-scoped session closes when the 202 goes out, so the `User` instance from the request would be detached by the time the task runs.
- **Progress writes use a short-lived session each.** A multi-minute job must not hold a write transaction open against the rows the polling requests are reading. `_set_job_progress` also swallows and logs its own failures — progress is cosmetic and must never abort an otherwise healthy run.
- **The runner re-fetches the job row before writing the terminal state**, since the progress callback has been updating it from other sessions.
- `result` duplicates the commentary rather than pointing at the `Commentary` row, so a job stays collectable even when the history write fails (0.4's resilience change).

#### Watch out: `create_all` drifts from Alembic

`init_db()` calls `SQLModel.metadata.create_all(engine)` on startup, which creates new tables **without** stamping Alembic. During this phase the development database ended up with `commentary_jobs` present while `alembic_version` still read `b45c00e4f9e6` — so a later `alembic upgrade head` would have failed on `CREATE TABLE` for a table that already existed. I could not pin the exact sequence that produced it, and repaired it by dropping the table and re-running the upgrade.

The migration chain itself is sound — verified by applying all four revisions to an empty database, then `downgrade base` (4 steps) and `upgrade head` (4 steps) again. But the underlying hazard is real for any environment that boots the app before migrating. Worth resolving separately: either drop `create_all` from `init_db` and rely on Alembic alone, or have startup `stamp head` when it creates the schema from scratch.

---

## 3. Phased extension work

Each phase builds, passes `npm run build`, and leaves the extension in a shippable state.

### Phase 1 — Shared plumbing (no user-visible change)

Extract, do not duplicate, the refresh-on-401 logic. `refreshTokens` + `authedFetch` currently live in [panel/panel.ts](panel/panel.ts) and a near-copy sits in [src/content.ts](src/content.ts).

- **New** `src/shared/api.ts` — owns `currentAuth`, `refreshTokens`, `authedFetch`, and `readErrorResponse` (parses the new `{detail, code, retry_after}` shape, falling back to DRF-style field errors). `panel.ts` and `background.ts` both import it.
- **New** `src/shared/commentary.ts` — the single model/language list, bounds (`num_comments` 1–100, `max_token` 256–8192, `custom_instruction` ≤ 1000), a `readCommentaryConfig` port, and `severityForDelta`. This mirrors [../frontend/src/types/commentary.ts](../frontend/src/types/commentary.ts) and [../frontend/src/constants/commentary/config.ts](../frontend/src/constants/commentary/config.ts) — a third copy of the same list — so the file carries a header comment naming the backend `Literal` as the source of truth and both files it must track. A build-time codegen step from the OpenAPI schema is the real fix; noted as a follow-up, not in scope.
- `src/shared/config.ts` gains `commentaryJobs`, `commentaryJob(id)`, and the two OGS endpoints.
- `src/shared/types.ts` gains `CommentaryItem`, `CommentaryResponse`, `CommentaryUsage`, `CommentaryConfig`, `JobStatus`, `OgsGameSummary`.

**Critical constraint:** these fetches must originate from an **extension context** (side panel or service worker), never the content script. The backend's `cors_origins` allows only the frontend origins; an MV3 content-script fetch uses the page origin (`https://online-go.com`) and would be blocked. Extension pages bypass CORS for hosts in `host_permissions`, which already covers both the API and `online-go.com`.

### Phase 2 — Game detection and the live-game guard

- `src/shared/ogs.ts` — `parseGameId(url)` matching `/game/:id`, `/game/view/:id`, `/game/:id/:move`; explicitly rejects `/review/*` and `/demo/*`.
- **Guard — two layers, both server truth, no DOM scraping:**
  1. `GET /api/v1/games/{id}` → require `gamedata.phase === "finished"` **and** `ended !== null`. `"play"` and `"stone removal"` are both not-finished.
  2. The SGF fetch itself 403s on in-progress games — a free backstop if OGS ever changes the metadata shape.
- The panel renders `screen-waiting` unless both layers pass. Nothing else activates.
- Failure modes handled explicitly: 404 (bad or private game id), 403 on SGF (live game, or analysis disabled — the API exposes `disable_analysis`), network error, malformed JSON.
- **Manifest:** broaden `content_scripts.matches` from `https://online-go.com/game/`_ to `https://online-go.com/_`so SPA navigation into a game is observed; add`"alarms"`to`permissions`.

### Phase 3 — Config screen, generation, display, footer

**Config screen** — new `#screen-config` reusing `.field-group` / `.field-input` / `.btn--primary`. Defaults come from `GET /auth/user/settings/` → `preferences.commentary_config`, run through the Phase 1 validator, falling back to the same defaults the frontend uses. Client-side bounds validation before send; `num_comments` is additionally clamped to the game's move count.

**Request** — exact `GenerateCommentaryRequest` shape. `sgf_file_name` is `ogs-${gameId}.sgf` — minimum 9 characters, comfortably over the backend's `min_length=5`; asserted anyway.

**Ownership of the long request** (this is the crux):

```
panel ──"start"──► service worker ──POST /jobs/──► 202 {job_id}
                        │
                        ├─ poll GET /jobs/{id}/ every 3s (each fetch < 15s → never trips the 30s rule)
                        ├─ chrome.alarms (1 min) resurrects the worker if it is killed between polls
                        └─ writes {status, progress, result|error} to chrome.storage.session
panel  ◄── chrome.storage.onChanged ── (pure view; close/reopen loses nothing)
```

- `chrome.storage.session` (10 MB, TRUSTED_CONTEXTS — panel + worker only) holds in-flight and completed state. A result is ~50–150 KB.
- **Timeouts:** per-request `AbortController` at **30 s** for the POST and **15 s** per poll. Overall job deadline **900 s (15 min)** — derived from 3 KataGo passes × the backend's `API_TIMEOUT` default of 120 s (360 s worst case) plus up to 100 sequential Claude calls, with headroom. Past that, something is genuinely wrong rather than slow.
- **Progress is real, not mocked.** `progress.done / progress.total` from the job drives `#progress-fill` and `#gen-subtitle`. The hardcoded `#gen-first-result` preview card in [panel/panel.html](panel/panel.html) is deleted — it is a fabricated result.

**Commentary display** — reuse `.card`, `.card--blunder|mistake|notable`, `.badge--black|white`, `.badge--blunder|mistake|notable` unchanged. Per card: `Move {turn}`, colour badge, `{delta}%` badge, comment text in `.card-body`.

```ts
function colorForTurn(
  moves: GameMove[],
  turn: number,
  fallback?: "B" | "W",
): "B" | "W" {
  return (moves[turn - 1]?.[0] as "B" | "W" | undefined) ?? fallback ?? "B";
}
```

Derived from the `moves` array, never from turn parity — verified necessary: OGS handicap game `65097807` has `HA[4]`, `AB[dd][pp][pd][dp]`, and **White plays move 1**.

**Footer** — the `#commentary-age` area gains total tokens (`input + output`), comment count, and model name from the Phase 0.3 response fields.

**Error handling** — one branch per case, driven by the Phase 0.4 `code`; no catch-all collapse.

| Condition                                                                    | Panel behaviour                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 401 after refresh fails                                                      | `handleDeadSession()` → demo screen, "Sign in again on the Kifu-Sensei website" + button   |
| `no_api_key` (409)                                                           | Route to the existing `#screen-api-key`                                                    |
| `upstream_rate_limited` (429)                                                | "Anthropic is rate-limiting your key." + retry-after countdown when the header was present |
| `katago_unavailable` / `upstream_auth_failed` (502) / `internal_error` (500) | Distinct copy each, Retry button                                                           |
| `invalid_sgf` (400)                                                          | "Kifu-Sensei couldn't read this game's record."                                            |
| `fetch` rejects                                                              | "Could not reach Kifu-Sensei. Check your connection."                                      |
| `AbortError` (deadline)                                                      | "This review took longer than 15 minutes and was stopped."                                 |

### Phase 4 — Regenerate and config persistence

Persist the last-used `CommentaryConfig` to `chrome.storage.local` under a single global key (not per-game). `↻ Regenerate` re-runs with the same config and the same cached SGF text — no re-fetch from OGS, so a game that has since become unavailable still regenerates.

### Phase 5 — Injected OGS button

- **Mount:** first child of `.game-action-buttons` if present; else after `.game-state` inside `.PlayControls`; else append to `.right-col`. All three verified on a live finished game.
- **SPA re-mount:** OGS is a single-page app and `.PlayControls` is React-rendered, so the node may not exist at `document_idle` and is replaced on navigation. Strategy: a `MutationObserver` on `document.body` (subtree) that re-mounts if the host is detached, plus a 500 ms `location.href` poller — the same idiom already used by [src/inject.ts](src/inject.ts). The Navigation API (`navigation.addEventListener("navigate")`) is deliberately **not** used: its behaviour from a content script's isolated world could not be confirmed, and polling is certain.
- **CSS isolation:** the host is a `<div>` with `attachShadow({ mode: "open" })` and `:host { all: initial }`. OGS's own CSS (Nunito 16 px on `.PlayControls`) cannot pierce a shadow boundary except through inherited properties, which `all: initial` resets. Nothing else on the page is touched.
- **Dark mode:** read `document.documentElement.dataset.theme` (`light | dark | accessible`) and mirror it onto the host, watched with a `MutationObserver` filtered to `data-theme`. **Not** `prefers-color-scheme` — OGS resolves its own `system` setting to a concrete value and writes it to that attribute.
- **Styling (assumption A1):** derived from `panel.css` tokens — `--ks-accent` `#2a6b4f` fill, 6 px radius, 600 weight, `icon-32.png`. Four states: unauthenticated (opens the login tab), ready, generating (spinner + progress), done.
- **Panel opening — the highest-risk item.** `chrome.sidePanel.open()` "may only be called in response to a user action", and the docs do not state whether a gesture propagates through `chrome.runtime.sendMessage` from a content script. Path: content-script click → `chrome.runtime.sendMessage` → background calls `chrome.sidePanel.open({ tabId })` **synchronously in the listener**, before any `await`. **Verify with a short spike before building the rest of Phase 5.** If it rejects, fall back to `chrome.sidePanel.setOptions({ tabId, enabled: true })` plus in-button copy directing the user to the toolbar icon — generation still starts, only the auto-open is lost.

---

## 4. File-by-file change list

**Backend — new**

| File                                                              | Rationale                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `backend/alembic/versions/<rev>_add_commentary_usage_and_jobs.py` | `commentaries.model` + `commentaries.usage`; `commentary_jobs` table |

**Backend — modified**

| File                             | Rationale                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/app/schemas.py`         | Fix model `Literal`; add `winrate_delta`/`color`; add `CommentaryUsageSchema`, `model`, `usage`; add `CommentaryErrorResponse` and job schemas |
| `backend/app/models.py`          | Fix default model; add `Commentary.model`/`.usage`; add `CommentaryJob`                                                                        |
| `backend/app/routers/go.py`      | Replace the `except Exception` catch-all with the typed chain; add the two job endpoints                                                       |
| `backend/app/services/katago.py` | Fix `_CLAUDE_MODEL`; return usage; emit `winrate_delta`/`color`; add `on_progress`; raise `MissingApiKeyError`                                 |
| `backend/app/errors.py`          | Define `MissingApiKeyError`                                                                                                                    |
| `backend/app/main.py`            | Register `CommentaryJob` with sqladmin                                                                                                         |

**Frontend — modified**

| File                                                      | Rationale                                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/types/commentary.ts`                        | Corrected `ClaudeModel`; `winrate_delta`/`color`/`usage`/`model` as **optional** — old History rows lack them, and required fields would fail `tsc` on `constants/commentary/demo.ts` |
| `frontend/src/components/commentary/CommentaryConfig.tsx` | Corrected `MenuItem` values                                                                                                                                                           |
| `frontend/src/pages/Commentary.tsx`                       | Map the new error `code` instead of one generic toast                                                                                                                                 |
| `frontend/src/constants/global/endpoints.ts`              | Job endpoints, for later web-app use                                                                                                                                                  |
| `README.md`, `backend/README.md`                          | Model tables                                                                                                                                                                          |

**Extension — new**

| File                          | Rationale                                                           |
| ----------------------------- | ------------------------------------------------------------------- |
| `src/shared/api.ts`           | Single `authedFetch` + refresh-on-401, extracted from `panel.ts`    |
| `src/shared/commentary.ts`    | Model/language lists, bounds, config validation, `severityForDelta` |
| `src/shared/ogs.ts`           | Game-id parsing, metadata + SGF fetch, finished-game guard          |
| `src/shared/jobs.ts`          | Job start/poll state machine over `chrome.storage.session`          |
| `src/button/inject-button.ts` | Shadow-DOM OGS button, mount/re-mount, theme mirroring              |
| `src/button/button.css.ts`    | Inlined shadow stylesheet built from `panel.css` tokens             |

**Extension — modified**

| File                                   | Rationale                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| [manifest.json](manifest.json)         | `content_scripts.matches` → `https://online-go.com/*`; add `"alarms"`                        |
| [src/background.ts](src/background.ts) | Owns job polling, alarms, and `sidePanel.open()` on content-script message                   |
| [src/content.ts](src/content.ts)       | Mount the button on OGS; drop its duplicated refresh logic in favour of `shared/api.ts`      |
| [panel/panel.html](panel/panel.html)   | Add `#screen-config`; **delete** the hardcoded `#gen-first-result` mock card                 |
| [panel/panel.ts](panel/panel.ts)       | Config/generating/commentary/error wiring; import the extracted API helpers                  |
| [panel/panel.css](panel/panel.css)     | Additions only for the config screen and footer stats — **no restyling of existing classes** |
| [README.md](README.md)                 | Update "what works vs WIP"; drop the stale production warning                                |

---

## 5. Risks

| Risk                                                                                                                               | Severity | Mitigation                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidePanel.open()` **gesture propagation** from content script → background is undocumented for this path                          | **High** | Spike it first, before the rest of Phase 5. Call it synchronously in the `onMessage` listener. Fallback: `setOptions({enabled: true})` + toolbar-icon prompt; generation still works. |
| **Service-worker lifetime** — the 30 s fetch-response cap kills any long request in the worker                                     | **High** | Structurally avoided by Phase 0.5: every worker fetch is a short poll. `chrome.alarms` resurrects the worker; `chrome.storage.session` holds all state so nothing is lost on death.   |
| **SPA mount** — `.PlayControls` is React-rendered, absent at `document_idle`, replaced on navigation                               | Medium   | `MutationObserver` + 500 ms `location.href` poll; three-level mount-point fallback; broadened `content_scripts.matches`.                                                              |
| **OGS DOM drift** — class names are not a public API                                                                               | Medium   | Fallback chain ends at `.right-col`; if all fail, log once and skip injection. The panel path is fully functional without the button.                                                 |
| **Long-request deadline (900 s)** may still be short for `num_comments=100` on a 300-move game                                     | Medium   | Deadline is a named constant; `AbortError` gets its own message telling the user to lower the comment count.                                                                          |
| **Backend job runner is in-process** (`BackgroundTasks`) — a Render restart mid-job orphans the row                                | Medium   | Jobs stuck in `running` past the deadline are reported as `internal_error` by the poller. A real queue is the follow-up if this bites.                                                |
| **Third copy of the model/language list** now lives in the extension                                                               | Low      | Header comment naming the backend `Literal` as source of truth and both mirror files; OpenAPI codegen noted as follow-up.                                                             |
| **Extension is not linted by CI** — no ESLint/Prettier config, and `scripts/ci-local.sh` covers only `backend/` and `frontend/src` | Low      | Match existing style manually (4-space indent, double quotes, semicolons, `trailingComma: "es5"`). Adding the extension to `make ci` is an explicitly optional follow-up.             |
| **Pre-existing:** `_extract_komi` substitutes 7.5 when komi is `0.0`, which is common in OGS handicap games                        | Low      | Out of scope; flagged for a separate fix.                                                                                                                                             |

---

## 6. Manual test checklist

**Phase 0**

- [ ] Generate with each of the four models; all four reach Anthropic (none 404). Previously three of four failed.
- [ ] A user whose saved preference is `claude-sonnet-5-0` loads the config screen without error (self-heals to the default).
- [ ] `alembic upgrade head` on a DB with existing commentaries; History still renders (nullable `model`/`usage`).
- [ ] Delete the Claude key → `POST /api/commentary/` returns **409** `no_api_key`, not 400.
- [ ] Stop the KataGo server → **502** `katago_unavailable`.
- [ ] Malformed SGF → **400** `invalid_sgf`.
- [ ] `POST /api/commentary/jobs/` returns 202; polling shows `progress.done` climbing to `total`.
- [ ] `GET /api/commentary/jobs/{id}/` with a **different user's** job → 404, not 403.

**Live-game guard**

- [ ] Open an **in-progress** OGS game → panel shows `screen-waiting`; no button, no request, no commentary.
- [ ] Open a game in **stone removal** phase → still treated as unfinished.
- [ ] Open a **finished** game → ready state.
- [ ] Force the metadata call to fail → waiting screen, no crash, no false activation.

**Handicap colour derivation**

- [ ] Load OGS game **65097807** (`HA[4]`, `AB[dd][pp][pd][dp]`, White plays move 1). Verify the colour badge on an odd-numbered turn reads **W**, and that turn parity would have given the wrong answer.
- [ ] Load an even game; colours alternate correctly from move 1 = Black.

**Auth**

- [ ] Expire the access token mid-generation → silently refreshed, job continues.
- [ ] Revoke the refresh token → demo screen with re-auth prompt, no infinite refresh loop.
- [ ] Sign out from the panel while a job runs → job cancelled, no stale result on re-login.

**No-API-key**

- [ ] Account with no key → generation routes to `#screen-api-key`; save a key → `#screen-key-saved` → generation succeeds.

**Service-worker lifetime**

- [ ] Start a job, **close the side panel**, wait 2 min, reopen → progress/result intact.
- [ ] Start a job, terminate the worker from `chrome://serviceworker-internals`, wait for the alarm → polling resumes, result arrives.
- [ ] Confirm no single extension fetch exceeds 15 s (DevTools Network on the worker).

**Errors**

- [ ] Rate-limited Anthropic key → 429 message with retry-after when the header is present.
- [ ] Offline → network message, distinct from the timeout message.
- [ ] Verify each error path produces **different** copy — no shared generic string.

**Injected button**

- [ ] Renders in `.game-action-buttons` on a finished game; absent on a live game.
- [ ] Toggle OGS light → dark → accessible (theme buttons in the OGS nav): button restyles without reload.
- [ ] Navigate `/overview` → a game **without a page reload**: button mounts.
- [ ] Navigate game → game: button re-mounts, state resets.
- [ ] OGS CSS does not leak in (button font is not Nunito 16 px).
- [ ] Click → panel opens **and** generation starts. If `sidePanel.open()` rejects, the fallback copy appears and generation still runs.

**Footer**

- [ ] Token total, comment count, and model name match the backend response.

---

## Verification

```bash
cd backend && uv run alembic upgrade head && uv run pytest -v
```

```bash
make ci
```

```bash
cd extension && npm run build
```

Then load `extension/` unpacked at `chrome://extensions` and walk the checklist above against a local backend (`make run-backend`, `make run-frontend`) with `extension/.env.development` pointing at localhost.
