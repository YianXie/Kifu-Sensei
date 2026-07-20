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
    userSettings: `${API_URL}/auth/user/settings/`,
    claudeApiKey: `${API_URL}/auth/user/claude-api-key/`,
} as const;
