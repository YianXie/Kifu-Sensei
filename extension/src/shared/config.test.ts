import { describe, expect, it } from "vitest";

import { API_URL, ENDPOINTS, FRONTEND_URL } from "./config";
import { OGS_ORIGIN } from "./constants";

describe("config", () => {
    it("resolves both base URLs", () => {
        expect(API_URL).toMatch(/^https?:\/\//);
        expect(FRONTEND_URL).toMatch(/^https?:\/\//);
    });
});

describe("ENDPOINTS", () => {
    it("derives every backend path from API_URL", () => {
        expect(ENDPOINTS.tokenRefresh).toBe(`${API_URL}/auth/token/refresh/`);
        expect(ENDPOINTS.userSettings).toBe(`${API_URL}/auth/user/settings/`);
        expect(ENDPOINTS.claudeApiKey).toBe(
            `${API_URL}/auth/user/claude-api-key/`
        );
        expect(ENDPOINTS.commentaryJobs).toBe(
            `${API_URL}/api/commentary/jobs/`
        );
    });

    it("builds a per-job polling URL", () => {
        expect(ENDPOINTS.commentaryJob("abc123")).toBe(
            `${API_URL}/api/commentary/jobs/abc123/`
        );
    });

    it("escapes a job id so it cannot alter the path", () => {
        // Job ids come back from the backend, but the URL is built by hand and
        // an unescaped `/` or `?` would silently change which resource is hit.
        expect(ENDPOINTS.commentaryJob("a/b?c")).toBe(
            `${API_URL}/api/commentary/jobs/a%2Fb%3Fc/`
        );
    });

    it("points the OGS calls at online-go.com", () => {
        expect(ENDPOINTS.ogsGame(42)).toBe(`${OGS_ORIGIN}/api/v1/games/42`);
        expect(ENDPOINTS.ogsGameSgf(42)).toBe(
            `${OGS_ORIGIN}/api/v1/games/42/sgf`
        );
    });

    it("uses https for OGS", () => {
        expect(OGS_ORIGIN).toBe("https://online-go.com");
    });
});
