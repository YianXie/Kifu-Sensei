import { describe, expect, it } from "vitest";

import { makeEndpoints } from "./endpoints";

const ENDPOINTS = makeEndpoints("https://api.example.test");

describe("makeEndpoints", () => {
    it("derives every path from the base it was given", () => {
        for (const value of Object.values(ENDPOINTS)) {
            const url =
                typeof value === "function" ? value("x" as never) : value;
            expect(url).toMatch(/^https:\/\/api\.example\.test\//);
        }
    });

    it("keeps the trailing slash the backend's routes require", () => {
        expect(ENDPOINTS.tokenObtain).toBe(
            "https://api.example.test/auth/token/"
        );
        expect(ENDPOINTS.userCommentaryHistory).toBe(
            "https://api.example.test/auth/user/commentary-history/"
        );
        expect(ENDPOINTS.userCommentaryHistoryDetail(7)).toBe(
            "https://api.example.test/auth/user/commentary-history/7/"
        );
    });

    it("exposes both the sync and the job commentary routes", () => {
        expect(ENDPOINTS.commentary).toBe(
            "https://api.example.test/api/commentary/"
        );
        expect(ENDPOINTS.commentaryJobs).toBe(
            "https://api.example.test/api/commentary/jobs/"
        );
    });

    // Only the extension's copy escaped the id; the web app's interpolated it raw.
    it("escapes a job id so it cannot alter the path", () => {
        expect(ENDPOINTS.commentaryJob("a/b?c")).toBe(
            "https://api.example.test/api/commentary/jobs/a%2Fb%3Fc/"
        );
    });
});
