/**
 * Every Kifu-Sensei backend URL, built from one base.
 *
 * A factory rather than a module-level constant because the two surfaces resolve
 * their base differently — the web app from its own `VITE_API_URL`, the extension
 * from its own — and because a function is testable without stubbing `import.meta`.
 *
 * The extension spreads this and adds its OGS URLs; the web app uses it as-is. Both
 * previously kept their own table, and the extension's had picked up an
 * `encodeURIComponent` on the job id that the web app's had not.
 */
export function makeEndpoints(apiUrl: string) {
    return {
        register: `${apiUrl}/auth/register/`,
        tokenObtain: `${apiUrl}/auth/token/`,
        tokenRefresh: `${apiUrl}/auth/token/refresh/`,
        logout: `${apiUrl}/auth/logout/`,
        userSettings: `${apiUrl}/auth/user/settings/`,
        userCommentaryHistory: `${apiUrl}/auth/user/commentary-history/`,
        userCommentaryHistoryDetail: (id: number) =>
            `${apiUrl}/auth/user/commentary-history/${id}/`,
        updateEmail: `${apiUrl}/auth/user/update-email/`,
        updatePassword: `${apiUrl}/auth/user/update-password/`,
        claudeApiKey: `${apiUrl}/auth/user/claude-api-key/`,
        aiProvider: `${apiUrl}/auth/user/ai-provider/`,
        deleteAccount: `${apiUrl}/auth/user/delete/`,
        /** Liveness: is this process up? Deliberately checks nothing else. */
        health: `${apiUrl}/api/health/`,
        /** Readiness: can it actually complete a review? 503 when KataGo is down. */
        ready: `${apiUrl}/api/ready/`,

        /** Synchronous commentary. One multi-minute request, no progress. */
        commentary: `${apiUrl}/api/commentary/`,

        // Async commentary. A Manifest V3 service worker is killed when a single
        // fetch response takes more than 30 seconds, so the extension cannot hold a
        // multi-minute request open. Submitting a job and polling it keeps every
        // request short and yields real progress.
        commentaryJobs: `${apiUrl}/api/commentary/jobs/`,
        commentaryJob: (jobId: string) =>
            `${apiUrl}/api/commentary/jobs/${encodeURIComponent(jobId)}/`,
    } as const;
}

export type Endpoints = ReturnType<typeof makeEndpoints>;
