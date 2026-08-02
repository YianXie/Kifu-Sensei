import { OGS_ORIGIN } from "./constants";

// Base URL of the Kifu-Sensei backend. Mirrors the web app's convention so the
// extension talks to the same API (localhost in dev, VITE_API_URL in prod).
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// Base URL of the Kifu-Sensei web app, used by the side panel to open the
// login/register tabs. Vite picks the value from .env.development (dev server
// / `--mode development` builds) or .env.production (plain `npm run build`).
export const FRONTEND_URL =
    import.meta.env.VITE_FRONTEND_URL ?? "http://localhost:5173";

export const ENDPOINTS = {
    tokenRefresh: `${API_URL}/auth/token/refresh/`,
    logout: `${API_URL}/auth/logout/`,
    userSettings: `${API_URL}/auth/user/settings/`,
    claudeApiKey: `${API_URL}/auth/user/claude-api-key/`,

    // Async commentary. The extension uses these rather than the synchronous
    // `/api/commentary/` the web app calls: a Manifest V3 service worker is killed
    // when a single fetch response takes more than 30 seconds, so a multi-minute
    // request cannot be held open. Submitting a job and polling it keeps every
    // request short and yields real progress.
    commentaryJobs: `${API_URL}/api/commentary/jobs/`,
    commentaryJob: (jobId: string) =>
        `${API_URL}/api/commentary/jobs/${encodeURIComponent(jobId)}/`,

    // OGS is unauthenticated for finished games. The SGF endpoint answers 403
    // ("Sign in to download SGF of in-progress games") while a game is still being
    // played, which backs up the phase check on the metadata endpoint.
    ogsGame: (gameId: number) => `${OGS_ORIGIN}/api/v1/games/${gameId}`,
    ogsGameSgf: (gameId: number) => `${OGS_ORIGIN}/api/v1/games/${gameId}/sgf`,
} as const;
