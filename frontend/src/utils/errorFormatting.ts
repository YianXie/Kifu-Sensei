import { AxiosError } from "axios";

import {
    type ResolvedCommentaryError,
    resolveCommentaryError,
} from "@shared/errors";
import { type PanelErrorCode, isCommentaryErrorCode } from "@shared/types";

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

/**
 * Turn a failed commentary request into a code to branch on, copy to show, and an
 * action for the primary button.
 *
 * The wording and the precedence live in `@shared/errors`, so the extension explains
 * the same failure with the same words; this only bridges Axios's error shape onto
 * the shared resolver. A request that never reached the server carries no code from
 * the backend, but "network" is a better thing to say about it than nothing.
 */
export function getCommentaryError(error: unknown): ResolvedCommentaryError {
    if (error instanceof AxiosError) {
        const data = error.response?.data as
            | { code?: unknown; detail?: unknown; retry_after?: unknown }
            | undefined;

        const code: PanelErrorCode | null = isCommentaryErrorCode(data?.code)
            ? data.code
            : error.response === undefined
              ? "network"
              : null;

        return resolveCommentaryError({
            code,
            detail:
                typeof data?.detail === "string"
                    ? data.detail
                    : getErrorMessage(error, "Error generating commentary."),
            retryAfter:
                typeof data?.retry_after === "number" ? data.retry_after : null,
        });
    }

    return resolveCommentaryError({
        code: null,
        detail: getErrorMessage(error, "Error generating commentary."),
        retryAfter: null,
    });
}
