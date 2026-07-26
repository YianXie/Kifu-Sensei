import { AxiosError } from "axios";

import type { CommentaryErrorCode } from "@/types/commentary";

export function getErrorMessage(
    error: unknown,
    fallback = "An unexpected error occurred."
): string {
    if (error instanceof AxiosError) {
        const data = error.response?.data;
        if (!data) return fallback;

        // DRF non-field errors
        if (typeof data.detail === "string") return data.detail;

        // DRF field errors — flatten to first message
        if (typeof data === "object") {
            const firstKey = Object.keys(data)[0];
            if (firstKey) {
                const val = data[firstKey];
                const msg = Array.isArray(val) ? val[0] : val;
                return `${firstKey}: ${msg}`;
            }
        }
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

const COMMENTARY_ERROR_MESSAGES: Record<CommentaryErrorCode, string> = {
    no_api_key: "Add your Claude API key to start generating commentary.",
    invalid_sgf:
        "That SGF file could not be read. Check that it is a valid game record.",
    upstream_rate_limited:
        "Anthropic is rate-limiting your API key. Please wait and try again.",
    upstream_auth_failed:
        "Anthropic rejected your API key. Check it under Settings.",
    upstream_error: "Claude could not be reached. Please try again.",
    katago_unavailable:
        "The analysis engine is unavailable. Please try again shortly.",
    internal_error:
        "Something went wrong generating commentary. Please try again.",
};

/**
 * Resolve a commentary failure into a code the caller can branch on and a message
 * worth showing the user. Falls back to {@link getErrorMessage} for anything that is
 * not one of the backend's tagged commentary errors — a network failure, for example,
 * never reaches the server and so carries no code.
 */
export function getCommentaryError(error: unknown): {
    code: CommentaryErrorCode | null;
    message: string;
} {
    if (error instanceof AxiosError) {
        const data = error.response?.data as
            | { code?: CommentaryErrorCode; retry_after?: number | null }
            | undefined;
        const code = data?.code;
        if (code && code in COMMENTARY_ERROR_MESSAGES) {
            if (
                code === "upstream_rate_limited" &&
                typeof data?.retry_after === "number"
            ) {
                return {
                    code,
                    message: `Anthropic is rate-limiting your API key. Try again in ${data.retry_after}s.`,
                };
            }
            return { code, message: COMMENTARY_ERROR_MESSAGES[code] };
        }
    }
    return {
        code: null,
        message: getErrorMessage(error, "Error generating commentary."),
    };
}
