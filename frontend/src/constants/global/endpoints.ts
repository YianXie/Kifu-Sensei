export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const ENDPOINTS = {
    register: `${API_URL}/auth/register/`,
    tokenObtain: `${API_URL}/auth/token/`,
    tokenRefresh: `${API_URL}/auth/token/refresh/`,
    userSettings: `${API_URL}/auth/user/settings/`,
    userCommentaryHistory: `${API_URL}/auth/user/commentary-history/`,
    updateEmail: `${API_URL}/auth/user/update-email/`,
    updatePassword: `${API_URL}/auth/user/update-password/`,
    claudeApiKey: `${API_URL}/auth/user/claude-api-key/`,
    deleteAccount: `${API_URL}/auth/user/delete/`,
    health: `${API_URL}/api/health/`,
    commentary: `${API_URL}/api/commentary/`,
} as const;
