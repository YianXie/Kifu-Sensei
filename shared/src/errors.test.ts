import { describe, expect, it } from "vitest";

import {
    COMMENTARY_ERROR_MESSAGES,
    GENERIC_ERROR_MESSAGE,
    errorAction,
    readErrorResponse,
    resolveCommentaryError,
} from "./errors";
import { COMMENTARY_ERROR_CODES, isCommentaryErrorCode } from "./types";

function jsonResponse(body: unknown, status = 400): Response {
    return new Response(JSON.stringify(body), { status });
}

describe("error codes", () => {
    // The backend declares nine; both clients used to list seven, so a 409 lost its
    // code on the way in and the panel offered a button that could only fail again.
    it("covers every code the backend can send", () => {
        expect(COMMENTARY_ERROR_CODES).toHaveLength(9);
        expect(COMMENTARY_ERROR_CODES).toContain("job_already_running");
        expect(COMMENTARY_ERROR_CODES).toContain("job_abandoned");
    });

    it("has a message for every code, backend and client alike", () => {
        for (const code of COMMENTARY_ERROR_CODES) {
            expect(COMMENTARY_ERROR_MESSAGES[code]).toBeTruthy();
        }
        for (const code of [
            "session_expired",
            "network",
            "timeout",
            "sgf_unavailable",
        ] as const) {
            expect(COMMENTARY_ERROR_MESSAGES[code]).toBeTruthy();
        }
    });

    it("rejects a code it does not know", () => {
        expect(isCommentaryErrorCode("nonsense")).toBe(false);
        expect(isCommentaryErrorCode(undefined)).toBe(false);
    });
});

describe("resolveCommentaryError", () => {
    it("prefers the client's copy over server prose for a known code", () => {
        const resolved = resolveCommentaryError({
            code: "no_api_key",
            detail: "This account has no Claude API key configured.",
            retryAfter: null,
        });

        expect(resolved.message).toBe(COMMENTARY_ERROR_MESSAGES.no_api_key);
        expect(resolved.detail).toBe("");
    });

    it("keeps the backend's detail as a second line where it is diagnostic", () => {
        const resolved = resolveCommentaryError({
            code: "invalid_sgf",
            detail: "Could not parse the SGF file: unexpected token at byte 12.",
            retryAfter: null,
        });

        expect(resolved.message).toBe(COMMENTARY_ERROR_MESSAGES.invalid_sgf);
        expect(resolved.detail).toContain("byte 12");
    });

    it("names the wait when the backend supplied retry_after", () => {
        expect(
            resolveCommentaryError({
                code: "upstream_rate_limited",
                detail: "",
                retryAfter: 30,
            }).message
        ).toContain("Try again in 30s");
    });

    it("omits the countdown when retry_after is null", () => {
        expect(
            resolveCommentaryError({
                code: "upstream_rate_limited",
                detail: "",
                retryAfter: null,
            }).message
        ).toBe(COMMENTARY_ERROR_MESSAGES.upstream_rate_limited);
    });

    it("falls back to the detail when there is no code to recognise", () => {
        expect(
            resolveCommentaryError({
                code: null,
                detail: "Bad Gateway",
                retryAfter: null,
            }).message
        ).toBe("Bad Gateway");
    });

    it("has something to say even with neither code nor detail", () => {
        expect(
            resolveCommentaryError({ code: null, detail: "", retryAfter: null })
                .message
        ).toBe(GENERIC_ERROR_MESSAGE);
    });
});

describe("errorAction", () => {
    it.each([
        ["no_api_key", "api-key"],
        ["session_expired", "sign-in"],
        ["internal_error", "retry"],
        ["upstream_error", "retry"],
        [null, "retry"],
    ] as const)("maps %s to %s", (code, expected) => {
        expect(errorAction(code)).toBe(expected);
    });

    // Retrying a 409 earns the same 409, so offering "Try again" is a button that
    // cannot work.
    it("does not offer a retry while another run holds the slot", () => {
        expect(errorAction("job_already_running")).toBe("wait");
    });
});

describe("readErrorResponse", () => {
    it("reads the tagged commentary error", async () => {
        expect(
            await readErrorResponse(
                jsonResponse({
                    detail: "Rate limited.",
                    code: "upstream_rate_limited",
                    retry_after: 12,
                })
            )
        ).toEqual({
            code: "upstream_rate_limited",
            detail: "Rate limited.",
            retryAfter: 12,
        });
    });

    it("carries the two job codes through instead of nulling them", async () => {
        const error = await readErrorResponse(
            jsonResponse(
                {
                    detail: "You already have a commentary review in progress.",
                    code: "job_already_running",
                },
                409
            )
        );

        expect(error.code).toBe("job_already_running");
    });

    it("keeps a field error from the auth endpoints", async () => {
        expect(
            (
                await readErrorResponse(
                    jsonResponse({ email: ["Already taken."] })
                )
            ).detail
        ).toBe("Already taken.");
    });

    it("accepts a bare string where a list was expected", async () => {
        expect(
            (await readErrorResponse(jsonResponse({ email: "Already taken." })))
                .detail
        ).toBe("Already taken.");
    });

    it("falls back for a body that is not JSON", async () => {
        const response = new Response("<html>502</html>", { status: 502 });

        expect(await readErrorResponse(response)).toEqual({
            code: null,
            detail: GENERIC_ERROR_MESSAGE,
            retryAfter: null,
        });
    });

    it("falls back for JSON that is not an object", async () => {
        expect((await readErrorResponse(jsonResponse("nope"))).detail).toBe(
            GENERIC_ERROR_MESSAGE
        );
    });

    it("uses the caller's fallback when one is given", async () => {
        expect(
            (await readErrorResponse(jsonResponse({}), "Could not save."))
                .detail
        ).toBe("Could not save.");
    });
});
