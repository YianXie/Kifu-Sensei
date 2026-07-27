# Kifu-Sensei Browser Extension

> ⚠️ **Load unpacked, for development.** Not published to the Chrome Web Store.
> The full flow — auth handoff, game detection, commentary generation, and the injected
> OGS button — is implemented, but it has not yet been exercised end to end in a real
> Chrome profile against a deployed backend. See the checklist in
> [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for what still needs confirming.

A Manifest V3 Chrome **side-panel** extension that brings Kifu-Sensei commentary next
to online-go.com games. It shares an account with the web app: you sign in on the
website, and the session is handed off to the extension so it can call the same backend.

## Stack

- **Manifest V3** Chrome extension
- **TypeScript**, bundled with **Vite** (multiple entry points), no UI framework — plain
  DOM + CSS for the side panel
- `chrome-types` for typed `chrome.*` APIs
- Talks to the same Kifu-Sensei backend as the web app

## Build & load

```bash
cd extension
npm install
cp .env.example .env    # set VITE_API_URL (backend); also set VITE_FRONTEND_URL (see below)
npm run build           # tsc + three vite builds → extension/dist/
```

Then in Chrome: **`chrome://extensions` → enable Developer mode → Load unpacked →
select the `extension/` folder** (the one containing `manifest.json`; the manifest
points at the built `dist/` files).

```bash
npm run dev   # vite watch — rebuilds dist/ on change (reload the extension in Chrome to pick up changes)
```

### Environment variables

Config is derived from env vars at build time (Vite inlines `import.meta.env.*`):

| Variable            | Used by     | Purpose                                                        |
| ------------------- | ----------- | -------------------------------------------------------------- |
| `VITE_API_URL`      | `config.ts` | Base URL of the backend (token refresh + settings validation). |
| `VITE_FRONTEND_URL` | `panel.ts`  | Frontend origin the panel opens for login/register.            |

> **Note:** `.env.example` currently only lists `VITE_API_URL`, but `panel.ts` also
> reads `VITE_FRONTEND_URL` to open the login/register tabs. Add it to your `.env`:
>
> ```
> VITE_API_URL=http://localhost:8000
> VITE_FRONTEND_URL=http://localhost:5173
> ```

## Manifest highlights (`manifest.json`)

- **`permissions`**: `storage`, `sidePanel`, `activeTab`, `tabs`, `scripting`.
- **`host_permissions`** / **content-script matches**: `localhost:5173`, `localhost:8000`,
  `online-go.com/*`, and `kifu-sensei.ai/*`.
- **`background`**: `dist/background.js` (service worker, ES module).
- **`content_scripts`**: `dist/content.js` runs on the frontend origins and on
  `online-go.com/game/*`.
- **`web_accessible_resources`**: `dist/inject.js`, so the content script can inject it
  into the page's own JS world.
- **`side_panel`**: `dist/panel/panel.html`. Clicking the toolbar icon opens the panel
  (wired up in the background worker).

## Build configuration

`npm run build` runs **three** Vite builds, because the four entry points are not all
loaded the same way. Each emits a predictable filename so the manifest can reference it:

| Entry        | Source              | Output               | Config                   | Format | Context it runs in                     |
| ------------ | ------------------- | -------------------- | ------------------------ | ------ | -------------------------------------- |
| `panel`      | `panel/panel.html`  | `dist/panel/panel.*` | `vite.config.ts`         | ESM    | The side-panel document                |
| `background` | `src/background.ts` | `dist/background.js` | `vite.config.ts`         | ESM    | The service worker                     |
| `content`    | `src/content.ts`    | `dist/content.js`    | `vite.content.config.ts` | IIFE   | Content script (isolated world)        |
| `inject`     | `src/inject.ts`     | `dist/inject.js`     | `vite.inject.config.ts`  | IIFE   | Injected into the page's main JS world |

`base: ""` throughout (relative paths, required for `chrome-extension://` loading).

**Why three configs.** Chrome loads content scripts as classic scripts, and `content.ts`
appends `inject.js` to the page with a plain `<script src=…>` — also classic. Neither
can contain an `import` statement; one there fails at runtime with _"Cannot use import
statement outside a module"_. Building them in the same pass as the module entries lets
Rollup hoist any code they share into a chunk, which emits exactly that import. Both are
therefore built as self-contained IIFEs, in their own passes (`emptyOutDir: false`, so
they run after the main build rather than wiping it).

The panel and the service worker are genuinely ES modules, so they may share a chunk.

## File structure

```
extension/
├── manifest.json            # MV3 manifest (references dist/ files)
├── vite.config.ts           # ESM entries (panel, background)
├── vite.content.config.ts   # content.ts as a self-contained IIFE
├── vite.inject.config.ts    # inject.ts as a self-contained IIFE
├── panel/
│   ├── panel.html           # side-panel markup — all screens, toggled by class
│   ├── panel.css            # side-panel styles
│   └── panel.ts             # side-panel logic (auth state, screen switching, sign-out)
├── src/
│   ├── background.ts        # service worker — owns job polling, alarms, panel open
│   ├── inject.ts            # page-world: polls website localStorage for auth
│   ├── content.ts           # isolated-world: validates & persists auth; starts the button
│   ├── button/
│   │   ├── ogs-button.ts    # the shadow-DOM button itself: states, styles, theme
│   │   ├── mount.ts         # where it goes, and re-mounting across SPA navigation
│   │   └── controller.ts    # what it says and what a click does
│   └── shared/
│       ├── api.ts           # authedFetch + refresh-on-401 + error-body parsing
│       ├── commentary.ts    # model/language lists, bounds, config validation
│       ├── config.ts        # API_URL + ENDPOINTS (backend and OGS)
│       ├── constants.ts     # storage keys + message tags shared across JS worlds
│       ├── jobs.ts          # job submit/poll state machine + timeouts
│       ├── ogs.ts           # game-id parsing, SGF fetch, finished-game guard
│       ├── types.ts         # API response shapes and auth types
│       └── auth.ts          # small localStorage auth helpers
└── public/icons/            # toolbar / panel icons (16–128px)
```

## Roles of each script

- **`background.ts`** — the service worker, and the owner of every long-running job.
  Calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so the
  toolbar icon opens the panel, submits commentary jobs, polls them, and mirrors
  progress into storage. **Why it polls rather than waiting:** Chrome terminates an MV3
  worker when a single `fetch()` takes more than 30 s, so a multi-minute request can
  never be held open here. Each poll is short, a `chrome.alarms` tick resurrects the
  worker if it is killed between polls, and all state lives in storage — so the panel is
  a pure view that can be closed and reopened without losing a run.
- **`inject.ts`** — runs in the **page's own JS world**. Content scripts can't read the
  website's `localStorage` (different world/storage area), so this script polls
  `localStorage["extension_auth"]` every 500 ms and `postMessage`s any change to the
  content script (tagged with a fixed `source`/`type` so the receiver can filter).
- **`content.ts`** — runs in the **isolated content-script world**. It injects
  `inject.js` into the page, listens for its messages, **validates** the received access
  token against the backend (`ENDPOINTS.userSettings`), **refreshes** it via
  `ENDPOINTS.tokenRefresh` if expired, and persists the verified pair to
  `chrome.storage.local["extension_auth"]`. It also honors the "revoked session" marker
  (below) so a signed-out session can't silently re-authenticate.
- **`panel.ts`** — the side-panel UI. Reads `chrome.storage.local`, renders the
  signed-in ("welcome") vs. unauthenticated ("demo") screen, and live-updates via
  `chrome.storage.onChanged`. Handles opening login/register/OGS tabs and sign-out.

## The auth handoff (the key cross-file flow)

The extension can't read the website's `localStorage` directly, so a session travels
through **four contexts**:

```
① frontend (ExtensionReady.tsx)          website page, React
   after web login, writes {accessToken, refreshToken}
   to localStorage["extension_auth"]
        │
        ▼  (polled every 500 ms)
② inject.ts                              page's main JS world
   detects the change, postMessage → content script
        │
        ▼  (window "message" event)
③ content.ts                             isolated content-script world
   validates the access token (refreshes if expired),
   then writes the verified pair to
   chrome.storage.local["extension_auth"]
        │
        ▼  (chrome.storage.onChanged)
④ panel.ts                               side-panel document
   renders the signed-in screen, live-updates
```

### Sign-out is subtle

When the user signs out **from the panel**, the website may still hold a stale
`extension_auth` in its own `localStorage`. Without protection, a freshly loaded
frontend tab would re-deliver it through steps ①–③ and silently sign the user back in.
To prevent this, `panel.ts`'s sign-out:

1. Records the revoked **refresh token** under
   `chrome.storage.local["revoked_refresh_token"]` (`REVOKED_KEY`).
2. Wipes `extension_auth` from any open frontend tabs via `chrome.scripting`.

`content.ts` checks `REVOKED_KEY` before adopting a session and ignores an exact match —
so a stale website entry can't re-authenticate, but a genuine re-login (which mints a
**new** refresh token) passes the check and clears the marker.

Signing out **on the website** (`AuthContext.logout`) also removes the website's
`extension_auth` key, covering the other direction.

> **Shared constants.** The storage keys and the message `source`/`type` tags live in
> `src/shared/constants.ts` and are imported by `inject.ts`, `content.ts`, and
> `panel.ts`. They used to be three hand-synced copies.

## Side-panel screens (`panel.html`)

The panel is a single document with several `.screen` sections; `showScreen(id)` toggles
exactly one visible via a `.hidden` class. Screens: `screen-demo` (unauthenticated
preview), `screen-welcome` (signed in), `screen-api-key`, `screen-generating`,
`screen-commentary`, `screen-error`, `screen-waiting`, `screen-config`. All are wired to
real logic.

## What works today vs. what's WIP

**Working**

- Toolbar icon opens the side panel; the injected OGS button opens it too.
- Full sign-in handoff from the web app → extension, with token validation/refresh.
- Live signed-in / signed-out panel state, greeting the user by email (decoded from the
  JWT).
- Robust sign-out that can't be silently undone by a stale website session.
- Detecting the current OGS game, guarding against unfinished ones, and pulling its SGF.
- Config screen (model, language, comment count, token budget, custom instruction)
  seeded from the account's saved preferences and persisted between runs.
- End-to-end commentary: submit → real progress → per-move cards with colour and
  win-rate delta → summary footer with model, comment count, and token usage.
- Regenerate, and a distinct actionable message for every backend error code.

**Known limits**

- The panel's progress bar reads `0%` until the backend reports a total. That is
  deliberate — it is honest about not knowing yet, rather than animating a guess.
- Regenerate spends real Anthropic tokens on a single click, with no confirmation step.
- `chrome.alarms` fires at most once a minute, so if the worker is killed between polls
  a run can appear stalled for up to a minute before polling resumes. Nothing is lost.

## Potential features / roadmap

- **Board overlay** — render win-rate swings and comment markers on the OGS board itself,
  not just in the panel.
- **In-panel API-key management** — add/replace the Claude key from the extension via the
  backend's `PUT /auth/user/claude-api-key/`. The panel currently routes to the web app.
- **History** — browse past reviews from the panel (the backend already exposes them).
- **Firefox / cross-browser** support once the flow stabilizes.
- **Lint in CI** — the extension is outside `make ci`, which covers only `backend/` and
  `frontend/src`. It has no ESLint or Prettier config of its own.
- **Generated API types** — `src/shared/commentary.ts` is a third hand-maintained copy
  of the model and language lists (the others are the backend `Literal`s and
  `frontend/src/types/commentary.ts`). Generating them from the OpenAPI schema would
  remove the duplication.

## Conventions

- Type every function signature; use the shared `ExtensionAuthObject` type for tokens.
- Talk to the backend only from the side panel or the service worker. A content
  script's `fetch` carries the page's origin, and the backend's CORS allowlist covers
  only the frontend origins — a request from online-go.com is blocked. Extension pages
  bypass CORS for hosts in `host_permissions`.
- Never log or persist tokens beyond `chrome.storage.local`; the panel only decodes the
  JWT locally to show the email.
- The extension is intentionally frameworkless — keep the panel plain DOM + CSS.
