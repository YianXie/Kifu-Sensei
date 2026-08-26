# Kifu-Sensei Frontend

React single-page app for Kifu-Sensei. Users register/log in, configure an encrypted
AI-provider credential, upload an SGF, and read move-by-move KataGo + AI commentary
on an interactive Go board. Past reviews are saved and re-openable from history.

## Stack

- **React 19** + **TypeScript**, built with **Vite 6**
- The **Kifu-Sensei design system** — plain CSS custom properties and `ks-` classes,
  vendored under `src/styles/ds/`, with a thin React component per design-system
  component in `src/components/ui/`. No component framework.
- **`@mui/icons-material`** for the Material Symbols Rounded glyph set, used only
  by `components/ui/Icon.tsx`
- **React Router v7** for routing
- **axios** for HTTP, with JWT attach + auto-refresh interceptors
- **`@sabaki/go-board`** for board geometry (liberties, captures)
- **react-toastify** for toasts, **jwt-decode** for reading token claims

## Setup

```bash
cd frontend
npm install
cp .env.example .env     # set VITE_API_URL (defaults to http://localhost:8000)
```

## Scripts

```bash
npm run dev           # Vite dev server on :5173
npm run build         # tsc -b && vite build → dist/
npm run typecheck     # tsc -b, without the bundle
npm run preview       # preview a production build
npm run lint          # eslint
npm run test          # vitest, once
npm run test:watch    # vitest, watching
npm run format        # prettier --write
npm run format:check  # prettier --check (this is what CI runs)
```

## Tests

Vitest + React Testing Library on jsdom, configured in `vitest.config.ts` — kept
separate from `vite.config.ts`, which it merges, so the production build config carries
nothing test-only. Test files are colocated: `src/api.test.ts` next to `src/api.ts`.

`src/test/setup.ts` registers the jest-dom matchers and shims two things jsdom does not
implement: `window.matchMedia`, which `useMediaQuery` (and so `ThemeProvider` and the
navbar's mobile breakpoint) reads during render, and `HTMLMediaElement.play`, which the
stone-placement sound calls.

Covered today: the axios interceptors (`api.test.ts` — token attachment, refresh-on-401,
the concurrent-request queue, the sign-out redirect), `AuthContext` hydration/login/logout,
`ProtectedRoute`, the `Controls` component, and the pure helpers in `utils/` and
`types/commentary.ts`.

Only `VITE_API_URL` is read from the environment (see `src/constants/global/endpoints.ts`).
It is the base URL of the backend API; every endpoint is derived from it.

## Path alias

`@/` resolves to `src/` (configured in both `vite.config.ts` and `tsconfig`). Prefer
`@/components/...` over long relative paths — it's the dominant convention in the codebase.

## Directory structure

```
src/
├── main.tsx                 # React root; wraps <App/> in <StrictMode>
├── App.tsx                  # Router + AuthProvider + ThemeProvider
├── api.ts                   # axios instance: JWT attach + 401 auto-refresh queue
├── index.css                # design-system entry point (imports only)
├── vite-env.d.ts
│
├── styles/ds/               # the design system, as CSS
│   ├── tokens/              # colors, typography, spacing, radii, elevation, motion, base
│   └── components/          # core, forms, surfaces, feedback, navigation, game,
│                            #   app (page composition), toastify (react-toastify skin)
│
├── pages/                   # one component per route
│   ├── Home.tsx             # marketing / landing page
│   ├── Login.tsx            # email + password sign-in
│   ├── Register.tsx         # account creation
│   ├── Logout.tsx           # clears tokens, redirects
│   ├── Commentary.tsx       # ★ main feature: SGF upload → board + commentary
│   ├── History.tsx          # list of past reviews
│   ├── Settings.tsx         # account + commentary config + AI provider mgmt
│   ├── SetupApiKey.tsx      # AI-provider and credential setup screen
│   ├── ExtensionReady.tsx   # writes tokens to localStorage for the extension handoff
│   └── NotFoundPage.tsx     # 404
│
├── components/
│   ├── ui/                           # one React component per design-system component
│   ├── global/ProtectedRoute.tsx     # gate for authenticated routes
│   ├── layout/                       # Layout, Navbar, Footer (app shell + nav)
│   ├── commentary/
│   │   ├── CommentaryConfig.tsx      # model / language / count / tokens / instructions form
│   │   └── SgfDropzone.tsx           # the .sgf upload target
│   ├── game/                         # board + review UI (see below)
│   │   ├── GameViewer.tsx            # orchestrates board + controls + comment panel
│   │   ├── GoBoard.tsx               # canvas board renderer (@sabaki/go-board)
│   │   ├── Controls.tsx              # move navigation (first / prev / next / last / jump)
│   │   ├── CommentPanel.tsx          # renders the comment for the current turn
│   │   └── CommentaryCard.tsx        # one commented move in the review list
│   ├── history/                      # HistoryCard + MiniBoardThumb (review previews)
│   └── home/Demo.tsx                 # sample commentary shown on the landing page
│
├── contexts/
│   ├── AuthContext.tsx       # auth state, user settings, login/logout
│   └── ThemeContext.tsx      # light/dark preference → <html data-theme>
├── hooks/
│   ├── usePageTitle.ts               # sets document.title per page
│   ├── useMediaQuery.ts              # subscribe to a CSS media query
│   └── useRedirectIfAuthenticated.ts # bounces logged-in users away from login/register
│
├── constants/                # endpoint URLs + tunable limits/config, grouped by domain
│   ├── global/endpoints.ts   # ENDPOINTS map (all API URLs)
│   ├── commentary/           # config bounds + demo data
│   └── game/                 # board + controls constants
│
├── types/                    # shared TypeScript types
│   ├── auth.ts               # AuthUser, JwtPayload, TokenResponse, UserSettings
│   ├── commentary.ts         # CommentaryResponse, config values, model/language unions
│   ├── game.ts               # GameMove tuple + isValidMove guard
│   └── api.ts
│
├── utils/                    # errorFormatting, commentary (severity/colour/coords),
│                             #   preferences, string helpers
└── assets/sounds/            # stone-placement sound
```

## How the pieces fit together

### Composition root — `App.tsx`

`App` wraps everything in `<BrowserRouter>` → `<AuthProvider>` → `<ThemedApp>`.
`ThemedApp` mounts `<ThemeProvider>` (see below) and declares all routes. Routes render
inside a shared `<Layout>` (navbar + `<Outlet>` + footer + toast container), and the
authenticated routes are additionally nested under `<ProtectedRoute>`:

```
/                  Home            (public)
/login             Login           (public)
/register          Register        (public)
  /commentary      Commentary      (protected)
  /settings        Settings        (protected)
  /history         History         (protected)
  /setup-api-key   SetupApiKey     (protected)
  /logout          Logout          (protected)
  /extension-ready ExtensionReady  (protected)
*                  NotFoundPage
```

### The design system — `styles/ds/` + `components/ui/`

The UI implements the Claude Design project `Kifu-Sensei.dc.html`. `styles/ds/` is a
near-verbatim copy of that project's CSS: tokens in `tokens/*.css`, component layers in
`components/*.css`, everything keyed on `ks-` class names. Two files are ours rather
than the design's — `components/app.css` (page composition, which the design expresses
as inline styles per screen) and `components/toastify.css` (re-skins react-toastify's
markup as the design's Toast). `src/index.css` imports them all, in order.

`components/ui/` holds one React component per design-system component, each rendering
exactly the markup its CSS expects: `Button`, `IconButton`, `Icon`, `Badge`, `Chip`,
`Divider`, `Field`, `Input`, `Select`, `Textarea`, `Switch`, `SegmentedControl`, `Card`,
`Panel`, `EmptyState`, `Alert`, `Dialog`, `Spinner`, `Tooltip`, `Menu`, `NavList`,
`Tabs`, `Drawer`. Compose screens from these rather than inventing new `ks-` classes.

**Colour comes only from the tokens.** Dark is the default; `<html data-theme="light">`
switches. Never hard-code a hex value in a component — every surface, border and accent
has a semantic alias in `tokens/colors.css`, which is what makes both themes work.

Icons are Material Symbols Rounded, addressed by ligature name — `<Icon name="history" />`.
They come from `@mui/icons-material` as SVG rather than the icon webfont the design
links, so there is no extra CDN request and no flash of raw ligature text; add an entry
to the `GLYPHS` map in `Icon.tsx` before using a new name. `Icon.tsx` is the only file
that touches MUI, and `@mui/material` stays in `package.json` solely because
`@mui/icons-material` requires it.

### Theming — `contexts/ThemeContext.tsx`

`ThemeProvider` owns the `"system" | "light" | "dark"` preference and writes the
resolved value to `<html data-theme>`. Two things set it, and they do not fight:

- The navbar toggle and the Settings segmented control call `setPreference` — immediate,
  and remembered in `localStorage["ks_theme"]` so a reload doesn't flash the old theme.
- The signed-in account preference (`userSettings.preferences.theme`) wins whenever the
  **server's** value changes: on hydration, on login, and when Settings saves it. A local
  toggle doesn't change the server value, so it is never clobbered by a re-render.

`"system"` follows the OS via `useMediaQuery("(prefers-color-scheme: dark)")`.

### Authentication — `contexts/AuthContext.tsx`

`AuthProvider` is the single source of truth for auth state. It exposes via `useAuth()`:

- `accessToken`, `refreshToken`, `user`, `userSettings`
- `isAuthenticated`, `isLoading`
- `login(email, password)`, `logout()`, `updateUserSettings(settings)`

Flow:

- **Tokens live in `localStorage`** (`access_token`, `refresh_token`).
- On **mount**, `hydrate()` reads the stored access token, decodes it with
  `jwt-decode`, and — if it hasn't expired — sets the user and fetches
  `GET /auth/user/settings/`. Any failure calls `logout()`.
- **`login`** posts to `/auth/token/`, stores both tokens, sets the user, then loads
  settings.
- **`logout`** removes both tokens **and** the `extension_auth` key, so signing out of
  the website doesn't leave a stale session the browser extension could silently pick
  up (see the extension README for the full handoff).
- `userSettings` carries `preferences`, legacy `has_claude_api_key`, and provider-safe
  `ai_provider` metadata. New UI gates use `ai_provider`; the legacy flag remains for
  older Claude accounts and compatibility responses.

`preferences` is one free-form JSON blob, and `PUT /auth/user/settings/` shallow-merges
it, so each screen sends only its own section: `theme` and `play_stone_sound` from
Settings → Miscellaneous, `commentary_config` from Settings → Default commentary config.
Provider credentials are managed separately through `GET`/`PUT`/`DELETE`
`/auth/user/ai-provider/`. The response contains only provider metadata, model, base URL,
and a credential-present flag; the credential itself is never returned.

### axios instance — `api.ts`

A shared axios instance (`import api from "@/api"`) with two interceptors:

1. **Request** — attaches `Authorization: Bearer <access_token>` from `localStorage`.
2. **Response** — on a `401`, transparently refreshes the token:
    - The first 401 triggers a single `POST /auth/token/refresh/`.
    - Concurrent requests that 401 while a refresh is in flight are parked in a
      `failedQueue` and replayed with the new token once it arrives (`processQueue`),
      so a burst of parallel calls only produces one refresh.
    - `originalRequest._retry` guards against infinite retry loops.
    - If refresh fails, tokens are cleared and the app hard-redirects to `/login`.

Use this `api` instance for all authenticated calls; only the refresh call itself uses
a bare `axios.post` (to avoid recursing through the interceptor).

### Route protection — `components/global/ProtectedRoute.tsx`

Renders an `<Outlet>` when authenticated, `null` while `isLoading` (so we don't flash
the login page during hydration), and otherwise `<Navigate to="/login" replace/>`.
Accepts an optional `customRedirect`.

### The main feature — `pages/Commentary.tsx` + `components/game/`

`Commentary.tsx` is the heart of the app:

It has four states — the AI-provider gate, upload, generating, and review:

1. Reads the user's default commentary config from their preferences
   (`readCommentaryConfig` in `types/commentary.ts`, which validates each field and
   falls back to `DEFAULT_COMMENTARY_CONFIG`).
2. Renders `CommentaryConfig` (model, language, number of comments, max tokens, custom
   instruction) beside `SgfDropzone` (`.sgf` only, click or drag).
3. Posts the SGF + config to `POST /api/commentary/` and receives a
   `CommentaryResponse` (`board_size`, `moves`, `initial_stones`, `comments[]`,
   `annotated_sgf_content`). The synchronous endpoint reports no intermediate progress,
   so the generating screen lists the pipeline's stages without pretending to track
   them.
4. Passes the result to `GameViewer`, which renders `GoBoard` + `Controls` +
   `CommentPanel`, and fills the rest of the side column with a scrollable list of
   `CommentaryCard`s. Commented turns are indexed by turn number so navigation can jump
   straight to them, and clicking a card moves the board to that turn.

Each card's severity tier and stone colour are derived client-side by
`utils/commentary.ts` — the API returns `winrate_delta` and the move list, not a tier,
since the tier is a display concern.

`GameMove` (`types/game.ts`) is a tuple `[color, [row, col] | null]`; `null` coords
mean a pass. `isValidMove` narrows the tuple to a placed stone.

## Types

Shared types live in `src/types/`. Commentary languages are kept **in sync with the
backend's Pydantic schemas** (`backend/app/schemas.py`). Model IDs are provider-defined
strings: Claude IDs remain useful defaults, while OpenAI-compatible endpoints may use
arbitrary IDs such as `gpt-4o`, `qwen2.5-7b`, or `llama3.1`.

## Conventions

- Type every function signature and prop.
- Import via the `@/` alias, not deep relative paths.
- Build screens out of `components/ui/` and the `ks-` classes. Reach for the design
  tokens (`var(--space-10)`, `var(--text-secondary)`) in the rare inline style; never
  hard-code a colour, or one of the two themes will be wrong.
- Prettier + ESLint are enforced in CI (`make ci` from the repo root). Imports are
  auto-sorted by `@trivago/prettier-plugin-sort-imports`.
- New logic that can be exercised without a running backend should come with a test.
  Vitest, `tsc -b`, ESLint and Prettier all gate the `frontend` CI job.
