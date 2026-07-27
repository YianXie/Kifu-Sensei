/**
 * Reading a game off online-go.com.
 *
 * The live-game guards get the most attention here: activating on a game still
 * being played is the one behaviour that must never happen, and both the phase
 * check and the SGF download exist to prevent it independently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENDPOINTS } from "./config";
import { checkOgsGame, fetchOgsSgf, parseOgsGameId } from "./ogs";

const FINISHED_GAME = {
    id: 65097807,
    ended: "2026-01-02T03:04:05Z",
    width: 19,
    height: 19,
    handicap: 0,
    disable_analysis: false,
    gamedata: { phase: "finished", moves: [[3, 3, 1000]] },
};

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

function textResponse(body: string, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(body),
        text: async () => body,
    } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // The module logs failures at warn level; keep the reporter readable.
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("parseOgsGameId", () => {
    it.each([
        ["https://online-go.com/game/65097807", 65097807],
        ["https://online-go.com/game/view/65097807", 65097807],
        ["https://online-go.com/game/65097807/42", 65097807],
        ["https://online-go.com/game/65097807/", 65097807],
    ])("accepts %s", (url, expected) => {
        expect(parseOgsGameId(url)).toBe(expected);
    });

    it.each([
        // Reviews and demos render through the same view but are not games.
        "https://online-go.com/review/1234",
        "https://online-go.com/demo/1234",
        // `embed` is an iframe target, not a move number.
        "https://online-go.com/game/65097807/embed",
        "https://online-go.com/observe-games/",
        "https://online-go.com/",
        // A look-alike origin must not be trusted.
        "https://online-go.com.evil.example/game/1",
        "http://online-go.com/game/1",
        "https://not-online-go.com/game/1",
        // Malformed input.
        "not a url",
        "https://online-go.com/game/abc",
        "https://online-go.com/game/0",
    ])("rejects %s", (url) => {
        expect(parseOgsGameId(url)).toBeNull();
    });

    it("returns null for a missing url", () => {
        expect(parseOgsGameId(undefined)).toBeNull();
    });
});

describe("checkOgsGame", () => {
    it("reports no-game without calling OGS when the tab is elsewhere", async () => {
        expect(await checkOgsGame("https://example.com/")).toEqual({
            state: "no-game",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns the summary for a finished game", async () => {
        fetchMock.mockResolvedValue(jsonResponse(FINISHED_GAME));

        const result = await checkOgsGame(
            "https://online-go.com/game/65097807"
        );

        expect(result).toEqual({
            state: "ready",
            gameId: 65097807,
            summary: FINISHED_GAME,
        });
        expect(fetchMock).toHaveBeenCalledWith(
            ENDPOINTS.ogsGame(65097807),
            expect.objectContaining({ signal: expect.anything() })
        );
    });

    it.each(["play", "stone removal"])(
        "refuses a game still in the %s phase",
        async (phase) => {
            fetchMock.mockResolvedValue(
                jsonResponse({
                    ...FINISHED_GAME,
                    ended: null,
                    gamedata: { phase },
                })
            );

            expect(
                await checkOgsGame("https://online-go.com/game/65097807")
            ).toEqual({ state: "unfinished", gameId: 65097807, phase });
        }
    );

    it("refuses a game whose phase says finished but which has no end time", async () => {
        // Both signals are required; either one alone could be stale.
        fetchMock.mockResolvedValue(
            jsonResponse({ ...FINISHED_GAME, ended: null })
        );

        const result = await checkOgsGame(
            "https://online-go.com/game/65097807"
        );

        expect(result).toMatchObject({ state: "unfinished" });
    });

    it("fails closed when OGS stops sending a phase", async () => {
        // Reporting `ready` here would activate on a game that might be live.
        fetchMock.mockResolvedValue(
            jsonResponse({ ...FINISHED_GAME, gamedata: {} })
        );

        expect(
            await checkOgsGame("https://online-go.com/game/65097807")
        ).toEqual({
            state: "unavailable",
            gameId: 65097807,
            reason: "malformed",
        });
    });

    it("fails closed when the payload is not JSON", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError("Unexpected token <");
            },
        } as unknown as Response);

        expect(
            await checkOgsGame("https://online-go.com/game/65097807")
        ).toMatchObject({ state: "unavailable", reason: "malformed" });
    });

    it("reports a missing game as not-found", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, 404));

        expect(
            await checkOgsGame("https://online-go.com/game/65097807")
        ).toEqual({
            state: "unavailable",
            gameId: 65097807,
            reason: "not-found",
        });
    });

    it.each([401, 403])("reports %i as forbidden", async (status) => {
        fetchMock.mockResolvedValue(jsonResponse({}, status));

        expect(
            await checkOgsGame("https://online-go.com/game/65097807")
        ).toMatchObject({ state: "unavailable", reason: "forbidden" });
    });

    it("reports any other error status as offline", async () => {
        fetchMock.mockResolvedValue(jsonResponse({}, 500));

        expect(
            await checkOgsGame("https://online-go.com/game/65097807")
        ).toEqual({ state: "offline", gameId: 65097807 });
    });

    it("reports a network failure as offline", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

        expect(
            await checkOgsGame("https://online-go.com/game/65097807")
        ).toEqual({ state: "offline", gameId: 65097807 });
    });
});

describe("fetchOgsSgf", () => {
    it("returns the SGF for a finished game", async () => {
        fetchMock.mockResolvedValue(textResponse("(;FF[4]GM[1]SZ[19];B[dd])"));

        expect(await fetchOgsSgf(65097807)).toEqual({
            ok: true,
            sgf: "(;FF[4]GM[1]SZ[19];B[dd])",
        });
        expect(fetchMock).toHaveBeenCalledWith(
            ENDPOINTS.ogsGameSgf(65097807),
            expect.anything()
        );
    });

    it.each([401, 403])(
        "reads %i as the second live-game guard",
        async (status) => {
            // OGS answers 403 "Sign in to download SGF of in-progress games",
            // so a game that slipped past the phase check still cannot be read.
            fetchMock.mockResolvedValue(textResponse("", status));

            expect(await fetchOgsSgf(65097807)).toEqual({
                ok: false,
                reason: "unfinished",
            });
        }
    );

    it("reports a 404 as not-found", async () => {
        fetchMock.mockResolvedValue(textResponse("", 404));
        expect(await fetchOgsSgf(65097807)).toEqual({
            ok: false,
            reason: "not-found",
        });
    });

    it("reports any other error status as offline", async () => {
        fetchMock.mockResolvedValue(textResponse("", 502));
        expect(await fetchOgsSgf(65097807)).toEqual({
            ok: false,
            reason: "offline",
        });
    });

    it("reports a network failure as offline", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        expect(await fetchOgsSgf(65097807)).toEqual({
            ok: false,
            reason: "offline",
        });
    });

    it.each(["", "   ", "<!DOCTYPE html>"])(
        "rejects a body that is not an SGF (%j)",
        async (body) => {
            // The backend enforces min_length=1 and would answer with a bare
            // validation error; catching it here gives a usable message.
            fetchMock.mockResolvedValue(textResponse(body));

            expect(await fetchOgsSgf(65097807)).toEqual({
                ok: false,
                reason: "empty",
            });
        }
    );

    it("tolerates leading whitespace before the opening paren", async () => {
        fetchMock.mockResolvedValue(textResponse("\n  (;FF[4])"));
        expect(await fetchOgsSgf(65097807)).toMatchObject({ ok: true });
    });
});
