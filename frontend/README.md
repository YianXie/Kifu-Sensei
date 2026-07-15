# Kifu-Sensei Frontend

React single-page app for Kifu-Sensei. Users register/log in, add their encrypted
Claude API key, upload an SGF, and read move-by-move KataGo + Claude commentary on
an interactive Go board. Past reviews are saved and re-openable from history.

## Stack

- **React 18** + **TypeScript**, built with **Vite 6**
- **Material UI (MUI) v9** (`@mui/material`, `@mui/icons-material`) with Emotion styling
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
npm run dev       # Vite dev server on :5173
npm run build     # tsc -b && vite build → dist/
npm run preview   # preview a production build
npm run lint      # eslint
npm run format    # prettier --write src/**/*.{ts,tsx,css}
```

Only `VITE_API_URL` is read from the environment (see `src/constants/global/endpoints.ts`).
It is the base URL of the backend API; every endpoint is derived from it.

## Path alias

`@/` resolves to `src/` (configured in both `vite.config.ts` and `tsconfig`). Prefer
`@/components/...` over long relative paths — it's the dominant convention in the codebase.

## Directory structure

```
src/
├── main.tsx                 # React root; wraps <App/> in <StrictMode>
├── App.tsx                  # Router + MUI theme provider + AuthProvider
├── api.ts                   # axios instance: JWT attach + 401 auto-refresh queue
├── index.css                # global CSS
├── vite-env.d.ts
│
├── pages/                   # one component per route
│   ├── Home.tsx             # marketing / landing page
│   ├── Login.tsx            # email + password sign-in
│   ├── Register.tsx         # account creation
│   ├── Logout.tsx           # clears tokens, redirects
│   ├── Commentary.tsx       # ★ main feature: SGF upload → board + commentary
│   ├── History.tsx          # list of past reviews
│   ├── Settings.tsx         # account + default commentary config + API key mgmt
│   ├── SetupApiKey.tsx      # dedicated Claude API-key entry/removal screen
│   ├── ExtensionReady.tsx   # writes tokens to localStorage for the extension handoff
│   └── NotFoundPage.tsx     # 404
│
├── components/
│   ├── global/ProtectedRoute.tsx     # gate for authenticated routes
│   ├── layout/                       # Layout, Navbar, NavSidebar (app shell + nav)
│   ├── commentary/CommentaryConfig.tsx   # model / language / count / tokens / instructions form
│   ├── game/                         # board + review UI (see below)
│   │   ├── GameViewer.tsx            # orchestrates board + controls + comment panel
│   │   ├── GoBoard.tsx               # SVG/DOM board renderer (@sabaki/go-board)
│   │   ├── Controls.tsx              # move navigation (first / prev / next / last / jump)
│   │   ├── ControlMoveButton.tsx     # a single "jump to commented move" button
│   │   └── CommentPanel.tsx          # renders the comment for the current turn
│   ├── history/                      # HistoryCard + MiniBoardThumb (review previews)
│   └── home/Demo.tsx                 # sample commentary shown on the landing page
│
├── contexts/AuthContext.tsx  # auth state, user settings, login/logout
├── hooks/
│   ├── usePageTitle.ts               # sets document.title per page
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
├── utils/                    # errorFormatting, string helpers
└── assets/sounds/            # stone-placement sound
```

## How the pieces fit together

### Composition root — `App.tsx`

`App` wraps everything in `<BrowserRouter>` → `<AuthProvider>` → `<ThemedApp>`.
`ThemedApp` builds the MUI theme (see below) and declares all routes. Routes render
inside a shared `<Layout>` (navbar + toast container + `<Outlet>`), and the
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

### MUI theming

The theme is created with `createTheme` inside a `useMemo` in `App.tsx` and provided
via `<ThemeProvider>` + `<CssBaseline>`:

- **Light/dark mode** is resolved from the user's saved preference
  (`userSettings.preferences.theme` — `"light" | "dark" | "system"`). When set to
  `"system"` (or unset/invalid), it follows the OS via
  `useMediaQuery("(prefers-color-scheme: dark)")`. The theme is memoized on the
  resolved mode so it only rebuilds when the effective mode changes.
- **Typography** uses an Inter-first font stack with system fallbacks.

Components style with MUI's `sx` prop and theme-aware tokens (`text.secondary`,
`success.main`, etc.) rather than hard-coded colors, so dark mode works automatically.
Layout uses MUI `Box`/`Container`/`Stack` primitives; icons come from
`@mui/icons-material`.

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
- `userSettings` carries `preferences` (theme, default commentary config) and
  `has_claude_api_key`, which the UI uses to decide whether to prompt for a key.

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

1. Reads the user's default commentary config from their preferences
   (`readCommentaryConfig` in `types/commentary.ts`, which validates each field and
   falls back to `DEFAULT_COMMENTARY_CONFIG`).
2. Renders `CommentaryConfig` (model, language, number of comments, max tokens, custom
   instruction) and a drag-and-drop SGF uploader (`.sgf` only).
3. Posts the SGF + config to `POST /api/commentary/` and receives a
   `CommentaryResponse` (`board_size`, `moves`, `initial_stones`, `comments[]`,
   `annotated_sgf_content`).
4. Passes the result to `GameViewer`, which renders `GoBoard` + `Controls` +
   `CommentPanel`. Commented turns are indexed by turn number so navigation can jump
   straight to them.

`GameMove` (`types/game.ts`) is a tuple `[color, [row, col] | null]`; `null` coords
mean a pass. `isValidMove` narrows the tuple to a placed stone.

## Types

Shared types live in `src/types/`. The commentary/model/language unions there are kept
**in sync with the backend's Pydantic schemas** (`backend/app/schemas.py`) — if you add
a model or language on the backend, update `ClaudeModel` / `CommentaryLanguage` here too.

## Conventions

- Type every function signature and prop.
- Import via the `@/` alias, not deep relative paths.
- Style with `sx` and theme tokens; avoid hard-coded colors so dark mode keeps working.
- Prettier + ESLint are enforced in CI (`make ci` from the repo root). Imports are
  auto-sorted by `@trivago/prettier-plugin-sort-imports`.
