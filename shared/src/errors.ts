// One explanation per failure, for both surfaces.
//
// Previously two tables with two opposite precedence rules: the panel preferred the
// backend's `detail` and so never showed its own copy (raw sgfmill exceptions reached
// the UI), while the web app preferred its copy and never showed `detail` at all.
// Four of the seven shared codes also differed word-for-word.
import type { CommentaryApiError, PanelErrorCode } from "./types";
import { isCommentaryErrorCode } from "./types";

export const COMMENTARY_ERROR_MESSAGES: Record<PanelErrorCode, string> = {
    no_api_key: "Add your Claude API key to start generating commentary.",
    invalid_sgf:
        "That game record could not be read. It may not be a valid SGF.",
    upstream_rate_limited:
        "Anthropic is rate-limiting your API key. Please wait and try again.",
    upstream_auth_failed:
        "Anthropic rejected your API key. Check it in Settings.",
    upstream_error: "Claude could not be reached. Please try again.",
    katago_unavailable:
        "The analysis engine is unavailable. Please try again shortly.",
    job_already_running:
        "A review is already running on your account. Wait for it to finish before starting another.",
    job_abandoned:
        "That review was interrupted before it finished. Start it again.",
    internal_error:
        "Something went wrong generating commentary. Please try again.",
    session_expired: "Your session expired. Sign in again.",
    network:
        "Could not reach Kifu-Sensei. Check your connection and try again.",
    timeout:
        "This review took too long and was stopped. Try again with fewer comments.",
    sgf_unavailable: "Could not download this game from online-go.com.",
};

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Codes where the backend's `detail` says something the canned copy cannot — which
 * SGF node failed to parse, which internal step blew up. Shown as a secondary line,
 * never as the headline: it is server-voiced and can carry an exception string.
 */
const CODES_WITH_USEFUL_DETAIL = new Set<PanelErrorCode>([
    "invalid_sgf",
    "internal_error",
]);

/** What the primary button on an error screen should do. */
export type ErrorAction = "retry" | "api-key" | "sign-in" | "wait";

export function errorAction(code: PanelErrorCode | null): ErrorAction {
    if (code === "no_api_key") return "api-key";
    if (code === "session_expired") return "sign-in";
    // Retrying is precisely what cannot work here: the backend rejects a second run
    // while one is active, so the same click would earn the same 409.
    if (code === "job_already_running") return "wait";
    return "retry";
}

export const ERROR_ACTION_LABELS: Record<ErrorAction, string> = {
    retry: "Try again",
    "api-key": "Add API key",
    "sign-in": "Sign in again",
    wait: "Back",
};

export interface ResolvedCommentaryError {
    code: PanelErrorCode | null;
    /** The headline. Client-authored whenever the code is one we recognise. */
    message: string;
    /** A diagnostic second line, or `""` when there is nothing worth adding. */
    detail: string;
    action: ErrorAction;
}

/**
 * Turn a normalised failure into what to show and what the button should do.
 *
 * Client copy wins for every known code; the backend's `detail` is the headline only
 * when there is no code to recognise, and a secondary line for the two codes where it
 * is genuinely diagnostic.
 */
export function resolveCommentaryError(
    error: CommentaryApiError
): ResolvedCommentaryError {
    const { code, detail, retryAfter } = error;

    if (code === null) {
        return {
            code: null,
            message: detail || GENERIC_ERROR_MESSAGE,
            detail: "",
            action: "retry",
        };
    }

    const message =
        code === "upstream_rate_limited" && typeof retryAfter === "number"
            ? `Anthropic is rate-limiting your API key. Try again in ${retryAfter}s.`
            : COMMENTARY_ERROR_MESSAGES[code];

    return {
        code,
        message,
        detail:
            CODES_WITH_USEFUL_DETAIL.has(code) && detail && detail !== message
                ? detail
                : "",
        action: errorAction(code),
    };
}

/**
 * Read a failed `fetch` Response into a {@link CommentaryApiError}.
 *
 * Handles three body shapes: the tagged commentary error
 * (`{detail, code, retry_after}`), the field errors the auth endpoints return
 * (`{field: ["message"]}`), and anything else.
 */
export async function readErrorResponse(
    response: Response,
    fallback = GENERIC_ERROR_MESSAGE
): Promise<CommentaryApiError> {
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return { code: null, detail: fallback, retryAfter: null };
    }
    if (typeof body !== "object" || body === null) {
        return { code: null, detail: fallback, retryAfter: null };
    }

    const record = body as Record<string, unknown>;

    if (isCommentaryErrorCode(record.code)) {
        return {
            code: record.code,
            detail:
                typeof record.detail === "string" && record.detail
                    ? record.detail
                    : fallback,
            retryAfter:
                typeof record.retry_after === "number"
                    ? record.retry_after
                    : null,
        };
    }

    if (typeof record.detail === "string" && record.detail) {
        return { code: null, detail: record.detail, retryAfter: null };
    }

    const firstKey = Object.keys(record)[0];
    if (firstKey) {
        const value = record[firstKey];
        const message = Array.isArray(value) ? value[0] : value;
        if (typeof message === "string" && message) {
            return { code: null, detail: message, retryAfter: null };
        }
    }

    return { code: null, detail: fallback, retryAfter: null };
}
