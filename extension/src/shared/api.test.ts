/**
 * Authenticated requests to the backend, and the refresh-on-401 retry.
 *
 * `authedFetch` is the one place the extension's session is spent, so the cases
 * that must not be confused with each other — offline, a dead session, a
 * recoverable expiry — each get their own test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeChrome } from "../test/setup";
import {
    authedFetch,
    clearStoredAuth,
    getCurrentAuth,
    isAuthObject,
    loadAuth,
    readErrorResponse,
    refreshTokens,
    setCurrentAuth,
} from "./api";
import { ENDPOINTS } from "./config";
import { AUTH_STORAGE_KEY } from "./constants";

const AUTH = { accessToken: "access-1", refreshToken: "refresh-1" };
const REFRESHED = { accessToken: "access-2", refreshToken: "refresh-2" };

function response(status: number, body: unknown = {}): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Module-level cache; reset so tests cannot see each other's session.
    setCurrentAuth(null);
});

afterEach(() => {
    vi.unstubAllGlobals();
    setCurrentAuth(null);
});

describe("isAuthObject", () => {
    it("accepts a well-formed pair", () => {
        expect(isAuthObject(AUTH)).toBe(true);
    });

    it.each([
        null,
        undefined,
        "a string",
        42,
        {},
        { accessToken: "a" },
        { refreshToken: "r" },
        { accessToken: 1, refreshToken: 2 },
        { accessToken: "a", refreshToken: null },
    ])("rejects %j", (value) => {
        expect(isAuthObject(value)).toBe(false);
    });
});

describe("loadAuth", () => {
    it("reads the session back from storage when memory is empty", async () => {
        // A revived Manifest V3 service worker starts with no module state.
        await fakeChrome().storage.local.set({ [AUTH_STORAGE_KEY]: AUTH });

        expect(await loadAuth()).toEqual(AUTH);
        expect(getCurrentAuth()).toEqual(AUTH);
    });

    it("does not hit storage when the session is already in memory", async () => {
        setCurrentAuth(AUTH);

        expect(await loadAuth()).toEqual(AUTH);
        expect(fakeChrome().storage.local.get).not.toHaveBeenCalled();
    });

    it("returns null when storage is empty", async () => {
        expect(await loadAuth()).toBeNull();
    });

    it("ignores a malformed stored value", async () => {
        await fakeChrome().storage.local.set({
            [AUTH_STORAGE_KEY]: { accessToken: "only-one" },
        });
        expect(await loadAuth()).toBeNull();
    });
});

describe("clearStoredAuth", () => {
    it("drops the session from memory and storage", async () => {
        setCurrentAuth(AUTH);
        await fakeChrome().storage.local.set({ [AUTH_STORAGE_KEY]: AUTH });

        await clearStoredAuth();

        expect(getCurrentAuth()).toBeNull();
        expect(fakeChrome().storage.local._dump()).toEqual({});
    });
});

describe("refreshTokens", () => {
    it("exchanges a refresh token for a fresh pair", async () => {
        fetchMock.mockResolvedValue(
            response(200, { access: "access-2", refresh: "refresh-2" })
        );

        expect(await refreshTokens("refresh-1")).toEqual(REFRESHED);
        expect(fetchMock).toHaveBeenCalledWith(ENDPOINTS.tokenRefresh, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh: "refresh-1" }),
        });
    });

    it("returns null when the refresh token is rejected", async () => {
        fetchMock.mockResolvedValue(response(401));
        expect(await refreshTokens("dead")).toBeNull();
    });

    it("returns null when the response omits either token", async () => {
        fetchMock.mockResolvedValue(response(200, { access: "access-2" }));
        expect(await refreshTokens("refresh-1")).toBeNull();
    });

    it("returns null when the backend is unreachable", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        expect(await refreshTokens("refresh-1")).toBeNull();
    });
});

describe("authedFetch", () => {
    it("returns null when there is no session at all", async () => {
        expect(await authedFetch("https://api.test/thing")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends the access token as a bearer credential", async () => {
        setCurrentAuth(AUTH);
        fetchMock.mockResolvedValue(response(200, { ok: true }));

        const result = await authedFetch("https://api.test/thing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        expect(result?.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith("https://api.test/thing", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer access-1",
            },
        });
    });

    it("passes a non-401 failure straight back to the caller", async () => {
        setCurrentAuth(AUTH);
        fetchMock.mockResolvedValue(response(409, { code: "no_api_key" }));

        const result = await authedFetch("https://api.test/thing");

        expect(result?.status).toBe(409);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes on a 401 and retries with the new token", async () => {
        setCurrentAuth(AUTH);
        fetchMock
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(
                response(200, { access: "access-2", refresh: "refresh-2" })
            )
            .mockResolvedValueOnce(response(200, { ok: true }));

        const result = await authedFetch("https://api.test/thing");

        expect(result?.status).toBe(200);
        expect(fetchMock).toHaveBeenNthCalledWith(3, "https://api.test/thing", {
            headers: { Authorization: "Bearer access-2" },
        });
    });

    it("persists the refreshed pair for the next service-worker wake-up", async () => {
        setCurrentAuth(AUTH);
        fetchMock
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(
                response(200, { access: "access-2", refresh: "refresh-2" })
            )
            .mockResolvedValueOnce(response(200));

        await authedFetch("https://api.test/thing");

        expect(getCurrentAuth()).toEqual(REFRESHED);
        expect(fakeChrome().storage.local._dump()).toEqual({
            [AUTH_STORAGE_KEY]: REFRESHED,
        });
    });

    it("returns the original 401 when the refresh token is dead too", async () => {
        // Not null: the caller has to tell a genuinely dead session apart from
        // being offline, and only the former should sign the user out.
        setCurrentAuth(AUTH);
        fetchMock
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(response(401));

        const result = await authedFetch("https://api.test/thing");

        expect(result?.status).toBe(401);
    });

    it("returns null when the request cannot be sent", async () => {
        setCurrentAuth(AUTH);
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

        expect(await authedFetch("https://api.test/thing")).toBeNull();
    });

    it("does not retry more than once", async () => {
        setCurrentAuth(AUTH);
        fetchMock
            .mockResolvedValueOnce(response(401))
            .mockResolvedValueOnce(
                response(200, { access: "access-2", refresh: "refresh-2" })
            )
            .mockResolvedValueOnce(response(401));

        const result = await authedFetch("https://api.test/thing");

        expect(result?.status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

describe("readErrorResponse", () => {
    it("reads a tagged commentary error", async () => {
        const error = await readErrorResponse(
            response(429, {
                detail: "Anthropic is rate-limiting this API key.",
                code: "upstream_rate_limited",
                retry_after: 30,
            })
        );

        expect(error).toEqual({
            code: "upstream_rate_limited",
            detail: "Anthropic is rate-limiting this API key.",
            retryAfter: 30,
        });
    });

    it("keeps retryAfter null when the backend did not supply one", async () => {
        const error = await readErrorResponse(
            response(409, { detail: "No key.", code: "no_api_key" })
        );
        expect(error.retryAfter).toBeNull();
    });

    it("ignores a code the extension does not know", async () => {
        const error = await readErrorResponse(
            response(400, { detail: "Something else.", code: "made_up" })
        );
        expect(error.code).toBeNull();
        expect(error.detail).toBe("Something else.");
    });

    it("reads a DRF non-field detail", async () => {
        const error = await readErrorResponse(
            response(401, { detail: "Token is invalid or expired." })
        );
        expect(error).toEqual({
            code: null,
            detail: "Token is invalid or expired.",
            retryAfter: null,
        });
    });

    it("reads the first message out of DRF field errors", async () => {
        const error = await readErrorResponse(
            response(400, { sgf_content: ["This field may not be blank."] })
        );
        expect(error.detail).toBe("This field may not be blank.");
    });

    it("reads a field error given as a bare string", async () => {
        const error = await readErrorResponse(
            response(400, { email: "Already taken." })
        );
        expect(error.detail).toBe("Already taken.");
    });

    it("falls back when the body is not JSON", async () => {
        const broken = {
            ok: false,
            status: 502,
            json: async () => {
                throw new SyntaxError("Unexpected token <");
            },
        } as unknown as Response;

        expect(await readErrorResponse(broken, "Gateway down.")).toEqual({
            code: null,
            detail: "Gateway down.",
            retryAfter: null,
        });
    });

    it("falls back when the body is JSON but not an object", async () => {
        expect(await readErrorResponse(response(500, "just a string"))).toEqual(
            {
                code: null,
                detail: "Something went wrong. Please try again.",
                retryAfter: null,
            }
        );
    });

    it("falls back when the body is an empty object", async () => {
        const error = await readErrorResponse(response(500, {}), "Fallback.");
        expect(error.detail).toBe("Fallback.");
    });

    it("falls back when detail is present but empty", async () => {
        const error = await readErrorResponse(
            response(500, { detail: "" }),
            "Fallback."
        );
        expect(error.detail).toBe("Fallback.");
    });
});
