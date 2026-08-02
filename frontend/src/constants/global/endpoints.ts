export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const ENDPOINTS = {
    register: `${API_URL}/auth/register/`,
    tokenObtain: `${API_URL}/auth/token/`,
    tokenRefresh: `${API_URL}/auth/token/refresh/`,
    logout: `${API_URL}/auth/logout/`,
    userSettings: `${API_URL}/auth/user/settings/`,
    userCommentaryHistory: `${API_URL}/auth/user/commentary-history/`,
    userCommentaryHistoryDetail: (id: number) =>
        `${API_URL}/auth/user/commentary-history/${id}/`,
    updateEmail: `${API_URL}/auth/user/update-email/`,
    updatePassword: `${API_URL}/auth/user/update-password/`,
    claudeApiKey: `${API_URL}/auth/user/claude-api-key/`,
    deleteAccount: `${API_URL}/auth/user/delete/`,
    health: `${API_URL}/api/health/`,
    commentary: `${API_URL}/api/commentary/`,
    // Async variant of `commentary`. The web app uses the synchronous endpoint; these
    // exist for clients that cannot hold a multi-minute request open — notably the
    // browser extension, whose service worker is killed after a 30-second fetch.
    commentaryJobs: `${API_URL}/api/commentary/jobs/`,
    commentaryJob: (jobId: string) =>
        `${API_URL}/api/commentary/jobs/${jobId}/`,
} as const;
