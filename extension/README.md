# Kifu-Sensei Browser Extension

> ⚠️ **Work in progress — NOT ready for production use.**
> The account/auth handoff between the web app and the extension works end to end,
> but the in-panel commentary generation flow (the API-key, generating, and
> commentary screens) is still being built. Load it unpacked for development only;
> it is not published to the Chrome Web Store.

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
npm run build           # tsc && vite build → extension/dist/
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

## Build configuration (`vite.config.ts`)

Vite is configured with **four entry points**, each emitting a predictable filename so
the manifest can reference it:

| Entry        | Source              | Output               | Context it runs in                     |
| ------------ | ------------------- | -------------------- | -------------------------------------- |
| `panel`      | `panel/panel.html`  | `dist/panel/panel.*` | The side-panel document                |
| `background` | `src/background.ts` | `dist/background.js` | The service worker                     |
| `content`    | `src/content.ts`    | `dist/content.js`    | Content script (isolated world)        |
| `inject`     | `src/inject.ts`     | `dist/inject.js`     | Injected into the page's main JS world |

Output is ES modules with `entryFileNames: "[name].js"` and `base: ""` (relative paths,
required for `chrome-extension://` loading).

## File structure

```
extension/
├── manifest.json            # MV3 manifest (references dist/ files)
├── vite.config.ts           # four-entry build config
├── panel/
│   ├── panel.html           # side-panel markup — all screens, toggled by class
│   ├── panel.css            # side-panel styles
│   └── panel.ts             # side-panel logic (auth state, screen switching, sign-out)
├── src/
│   ├── background.ts        # service worker — opens the panel on toolbar click
│   ├── inject.ts            # page-world: polls website localStorage for auth
│   ├── content.ts           # isolated-world: validates & persists auth
│   └── shared/
│       ├── config.ts        # API_URL + ENDPOINTS (tokenRefresh, userSettings)
│       ├── types.ts         # ExtensionAuthObject { accessToken, refreshToken }
│       └── auth.ts          # small localStorage auth helpers
└── public/icons/            # toolbar / panel icons (16–128px)
```

## Roles of each script

- **`background.ts`** — minimal service worker. Calls
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so clicking the
  toolbar icon opens the side panel.
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

> **Keep constants in sync.** `STORAGE_KEY` / `REVOKED_KEY` and the message
> `source`/`type` constants are duplicated across `inject.ts`, `content.ts`, and
> `panel.ts`. If you rename one, rename all of them.

## Side-panel screens (`panel.html`)

The panel is a single document with several `.screen` sections; `showScreen(id)` toggles
exactly one visible via a `.hidden` class. Screens: `screen-demo` (unauthenticated
preview), `screen-welcome` (signed in), `screen-api-key`, `screen-generating`,
`screen-commentary`, `screen-error`, `screen-waiting`. **Today only the demo and welcome
screens are wired to real logic** — the API-key, generating, and commentary screens are
static scaffolding for the WIP flow described below.

## What works today vs. what's WIP

**Working**

- Toolbar icon opens the side panel.
- Full sign-in handoff from the web app → extension, with token validation/refresh.
- Live signed-in / signed-out panel state, greeting the user by email (decoded from the
  JWT).
- Robust sign-out that can't be silently undone by a stale website session.

**Not yet implemented**

- Detecting the current OGS game and extracting its SGF from the page.
- Triggering `POST /api/commentary/` from the panel and driving the generating →
  commentary screens with real data.
- In-panel Claude API-key entry (the `screen-api-key` markup exists but isn't wired).
- Overlaying commentary directly on the OGS board.

## Potential features / roadmap

- **Live OGS integration** — auto-detect a finished game, pull the SGF, and generate
  commentary without leaving the page.
- **Board overlay** — render win-rate swings and comment markers on the OGS board itself,
  not just in the panel.
- **In-panel API-key management** — add/replace the Claude key from the extension via the
  backend's `PUT /auth/user/claude-api-key/`.
- **Progress streaming** — real move-by-move progress on the generating screen instead of
  the current static mock.
- **Regenerate / history** — re-run a review and browse past reviews from the panel
  (backend already exposes commentary history).
- **Config controls** — model/language/comment-count pickers mirroring the web app.
- **Firefox / cross-browser** support once the flow stabilizes.
- **Robust config** — ship `VITE_FRONTEND_URL` in `.env.example` and centralize all
  shared constants to remove the manual sync between scripts.

## Conventions

- Type every function signature; use the shared `ExtensionAuthObject` type for tokens.
- Never log or persist tokens beyond `chrome.storage.local`; the panel only decodes the
  JWT locally to show the email.
- The extension is intentionally frameworkless — keep the panel plain DOM + CSS.
