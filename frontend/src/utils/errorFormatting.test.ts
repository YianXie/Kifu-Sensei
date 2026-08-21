import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import type { CommentaryErrorCode } from "@shared/types";

import { getCommentaryError, getErrorMessage } from "@/utils/errorFormatting";

/** Build an AxiosError carrying `data` as the response body. */
function axiosErrorWith(data: unknown, status = 400): AxiosError {
    const config = { headers: new AxiosHeaders() };
    const error = new AxiosError("Request failed", "ERR_BAD_REQUEST", config);
    error.response = {
        data,
        status,
        statusText: "",
        headers: {},
        config,
    } as AxiosError["response"];
    return error;
}

describe("getErrorMessage", () => {
    it("prefers the DRF non-field detail", () => {
        const error = axiosErrorWith({
            detail: "No active account found with the given credentials.",
        });
        expect(getErrorMessage(error)).toBe(
            "No active account found with the given credentials."
        );
    });

    it("flattens a DRF field error to `field: first message`", () => {
        const error = axiosErrorWith({
            email: ["A user with this email already exists."],
        });
        expect(getErrorMessage(error)).toBe(
            "email: A user with this email already exists."
        );
    });

    it("accepts a bare string where a list was expected", () => {
        expect(
            getErrorMessage(axiosErrorWith({ email: "Already taken." }))
        ).toBe("email: Already taken.");
    });

    it("falls back when the response carries no body", () => {
        const error = new AxiosError("Network Error", "ERR_NETWORK");
        expect(getErrorMessage(error, "Offline.")).toBe("Offline.");
    });

    it("uses the message of a plain Error", () => {
        expect(getErrorMessage(new Error("boom"))).toBe("boom");
    });

    it("falls back for a thrown value that is not an Error", () => {
        expect(getErrorMessage("just a string", "Fallback.")).toBe("Fallback.");
        expect(getErrorMessage(undefined, "Fallback.")).toBe("Fallback.");
    });

    it("uses the documented default when no fallback is given", () => {
        expect(getErrorMessage(null)).toBe("An unexpected error occurred.");
    });
});

describe("getCommentaryError", () => {
    const codes: CommentaryErrorCode[] = [
        "no_api_key",
        "invalid_sgf",
        "upstream_rate_limited",
        "upstream_auth_failed",
        "upstream_error",
        "katago_unavailable",
        "internal_error",
    ];

    it.each(codes)("recognises the %s code from the backend", (code) => {
        const result = getCommentaryError(
            axiosErrorWith({ detail: "server prose", code })
        );
        expect(result.code).toBe(code);
        expect(result.message).not.toBe("server prose");
        expect(result.message.length).toBeGreaterThan(0);
    });

    it("names the wait when the backend supplied retry_after", () => {
        const result = getCommentaryError(
            axiosErrorWith(
                {
                    detail: "rate limited",
                    code: "upstream_rate_limited",
                    retry_after: 30,
                },
                429
            )
        );
        expect(result.code).toBe("upstream_rate_limited");
        expect(result.message).toContain("30s");
    });

    it("omits the countdown when retry_after is null", () => {
        const result = getCommentaryError(
            axiosErrorWith(
                {
                    detail: "rate limited",
                    code: "upstream_rate_limited",
                    retry_after: null,
                },
                429
            )
        );
        expect(result.message).not.toContain("null");
        expect(result.message).toContain("wait");
    });

    it("returns a null code for an unrecognised one", () => {
        const result = getCommentaryError(
            axiosErrorWith({ detail: "Something else.", code: "made_up" })
        );
        expect(result.code).toBeNull();
        expect(result.message).toBe("Something else.");
    });

    // A request with no response never reached the backend, so there is no code to
    // read — but "network" is a truer thing to say about it than the generic branch.
    it("reports a request that never reached the server as a network failure", () => {
        const result = getCommentaryError(
            new AxiosError("Network Error", "ERR_NETWORK")
        );
        expect(result.code).toBe("network");
        expect(result.message).toContain("Check your connection");
    });

    it("returns a null code for a non-Axios throw", () => {
        expect(getCommentaryError(new Error("boom"))).toMatchObject({
            code: null,
            message: "boom",
        });
    });

    it("hands the caller an action for the primary button", () => {
        expect(
            getCommentaryError(
                axiosErrorWith({ detail: "", code: "no_api_key" })
            ).action
        ).toBe("api-key");
    });
});
