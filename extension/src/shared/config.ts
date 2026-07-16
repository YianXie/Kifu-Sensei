// Base URL of the Kifu-Sensei backend. Mirrors the web app's convention so the
// extension talks to the same API (localhost in dev, VITE_API_URL in prod).
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const ENDPOINTS = {
    tokenRefresh: `${API_URL}/auth/token/refresh/`,
    userSettings: `${API_URL}/auth/user/settings/`,
    claudeApiKey: `${API_URL}/auth/user/claude-api-key/`,
} as const;
