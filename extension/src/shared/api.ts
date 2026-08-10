// Authenticated requests to the Kifu-Sensei backend, with refresh-on-401.
//
// Previously duplicated between `panel.ts` and `content.ts`. Both now import this, so
// the refresh behaviour cannot drift between the side panel and the content script.
//
// IMPORTANT: only extension contexts (the side panel and the service worker) may call
// `authedFetch`. A Manifest V3 content script's `fetch` carries the *page's* origin,
// and the backend's CORS allowlist covers only the frontend origins — a request from
// `https://online-go.com` would be blocked. Extension pages bypass CORS for hosts in
// `host_permissions`, which already covers the API.
import type { CommentaryApiError, CommentaryErrorCode } from "@shared/types";

import { ENDPOINTS } from "./config";
import { AUTH_STORAGE_KEY } from "./constants";
import type { ExtensionAuthObject } from "./types";

// The session backing requests from this context. Service workers are torn down
// aggressively, so this is a cache in front of chrome.storage.local, never the
// authority — see `loadAuth`.
let currentAuth: ExtensionAuthObject | null = null;

export function isAuthObject(value: unknown): value is ExtensionAuthObject {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as ExtensionAuthObject).accessToken === "string" &&
        typeof (value as ExtensionAuthObject).refreshToken === "string"
    );
}

export function setCurrentAuth(auth: ExtensionAuthObject | null): void {
    currentAuth = auth;
}

export function getCurrentAuth(): ExtensionAuthObject | null {
    return currentAuth;
}

/**
 * Return the session for this context, reading it back from storage when the
 * in-memory copy is empty. A revived service worker starts with no module state, so
 * requests must not assume a prior call populated it.
 */
export async function loadAuth(): Promise<ExtensionAuthObject | null> {
    if (currentAuth !== null) {
        return currentAuth;
    }
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    currentAuth = isAuthObject(auth) ? auth : null;
    return currentAuth;
}

/** Drop the stored session. Callers decide what the UI does about it. */
export async function clearStoredAuth(): Promise<void> {
    currentAuth = null;
    await chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

/** Exchange a refresh token for a fresh pair, or null if it is rejected. */
export async function refreshTokens(
    refreshToken: string
): Promise<ExtensionAuthObject | null> {
    try {
        const response = await fetch(ENDPOINTS.tokenRefresh, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh: refreshToken }),
        });
        if (!response.ok) {
            return null;
        }
        const data = (await response.json()) as {
            access?: string;
            refresh?: string;
        };
        if (!data.access || !data.refresh) {
            return null;
        }
        return { accessToken: data.access, refreshToken: data.refresh };
    } catch (error) {
        console.error("[Kifu-Sensei] Token refresh failed:", error);
        return null;
    }
}

/**
 * Send an authenticated request, retrying once with a refreshed token on 401.
 *
 * Returns null when the backend is unreachable, so callers can tell "offline" apart
 * from a 401 meaning the session is genuinely dead. A rejected refresh returns the
 * original 401 response rather than null, for the same reason.
 */
export async function authedFetch(
    url: string,
    init: RequestInit = {}
): Promise<Response | null> {
    const auth = await loadAuth();
    if (auth === null) {
        return null;
    }

    const send = (token: string): Promise<Response> =>
        fetch(url, {
            ...init,
            headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });

    try {
        const response = await send(auth.accessToken);
        if (response.status !== 401) {
            return response;
        }

        const refreshed = await refreshTokens(auth.refreshToken);
        if (refreshed === null) {
            // The refresh token is dead too; let the caller handle the 401.
            return response;
        }
        currentAuth = refreshed;
        await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: refreshed });
        return await send(refreshed.accessToken);
    } catch (error) {
        console.error("[Kifu-Sensei] Request failed:", url, error);
        return null;
    }
}

const COMMENTARY_ERROR_CODES: readonly CommentaryErrorCode[] = [
    "no_api_key",
    "invalid_sgf",
    "upstream_rate_limited",
    "upstream_auth_failed",
    "upstream_error",
    "katago_unavailable",
    "internal_error",
];

function isCommentaryErrorCode(value: unknown): value is CommentaryErrorCode {
    return COMMENTARY_ERROR_CODES.includes(value as CommentaryErrorCode);
}

/**
 * Normalise a failed response into a code the caller can branch on.
 *
 * Handles three body shapes: the tagged commentary error
 * (`{detail, code, retry_after}`), the DRF-style field errors the auth endpoints
 * return (`{field: ["message"]}`), and anything else.
 */
export async function readErrorResponse(
    response: Response,
    fallback = "Something went wrong. Please try again."
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
