/**
 * api.ts
 *
 * Typed wrappers around every Kifu-Sensei backend endpoint the extension
 * needs to call. Also includes fetchOgsSgf(), which hits the OGS REST API
 * to retrieve the SGF for a game — a step the extension needs before it
 * can send a commentary request.
 *
 * Design decisions:
 *   - Native fetch only (no axios — not available in extension contexts).
 *   - Every function that requires auth attaches the Bearer token and will
 *     attempt one silent token refresh on a 401 before giving up.
 *   - Errors surface as thrown Error objects with human-readable messages
 *     so callers can display them directly in the panel UI.
 *   - This file has no knowledge of chrome.runtime or the DOM. It is a
 *     pure HTTP utility layer suitable for use in any extension context.
 */

import type {
    DetailResponse,
    GenerateCommentaryRequest,
    GenerateCommentaryResponse,
    TokenPairResponse,
    UserSettingsResponse,
} from "./types";
import {
    clearAuthData,
    getStoredAuth,
    isAccessTokenExpired,
    refreshAccessToken,
    storeAuthData,
    syncUserSettings,
} from "./auth";

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

/**
 * The Kifu-Sensei backend base URL.
 *
 * In development, set VITE_API_URL in the extension's .env file to point
 * at a local backend (e.g. http://localhost:8000). The production default
 * matches the deployed backend behind Cloudflare.
 */
const BACKEND_BASE = import.meta.env.VITE_API_URL ?? "https://kifu-sensei.ai";

/** OGS REST API base URL, used only for fetching game SGFs. */
const OGS_API_BASE = "https://online-go.com/api/v1";

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

/**
 * Makes an authenticated fetch request to the Kifu-Sensei backend.
 *
 * Handles two concerns on top of raw fetch:
 *   1. Token attachment — reads the current JWT from chrome.storage.local
 *      and adds an `Authorization: Bearer` header. If the stored token is
 *      already expired (checked by decoding the exp claim), it attempts a
 *      silent refresh before sending the request.
 *   2. Auto-refresh on 401 — if the server returns 401 despite a seemingly
 *      valid token, attempts one refresh and retries. If the refresh also
 *      fails, clears auth data and throws so the caller can redirect to login.
 *
 * For unauthenticated endpoints (login, register), use plain `fetch` instead.
 *
 * @param path    Path relative to BACKEND_BASE, e.g. "/auth/user/settings/"
 * @param init    Standard RequestInit (method, body, headers, etc.)
 * @returns       The parsed JSON response body, typed as T.
 * @throws        Error with a user-readable message on HTTP errors or network failure.
 */
async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    let { jwt } = await getStoredAuth();

    // Proactively refresh if the token is expired before sending — avoids
    // sending a request we know will fail with 401.
    if (jwt && isAccessTokenExpired(jwt)) {
        jwt = (await refreshAccessToken()) ?? undefined;
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string>),
    };

    if (jwt) {
        headers["Authorization"] = `Bearer ${jwt}`;
    }

    const response = await fetch(`${BACKEND_BASE}${path}`, {
        ...init,
        headers,
    });

    // On 401, attempt one silent refresh and retry before giving up
    if (response.status === 401) {
        const newToken = await refreshAccessToken();

        if (!newToken) {
            // Refresh failed — the user must log in again
            await clearAuthData();
            throw new Error("Your session has expired. Please log in again.");
        }

        // Retry the original request with the new token
        const retryResponse = await fetch(`${BACKEND_BASE}${path}`, {
            ...init,
            headers: { ...headers, Authorization: `Bearer ${newToken}` },
        });

        if (!retryResponse.ok) {
            throw await buildApiError(retryResponse);
        }

        return retryResponse.json() as Promise<T>;
    }

    if (!response.ok) {
        throw await buildApiError(response);
    }

    return response.json() as Promise<T>;
}

/**
 * Builds an Error from a non-OK response, using the backend's `detail`
 * field if present (FastAPI validation errors and HTTPExceptions both use
 * this shape) or falling back to the HTTP status text.
 */
async function buildApiError(response: Response): Promise<Error> {
    try {
        const body = (await response.json()) as { detail?: string | object };
        const message =
            typeof body.detail === "string"
                ? body.detail
                : JSON.stringify(body.detail ?? response.statusText);
        return new Error(message);
    } catch {
        return new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

/**
 * Registers a new account via POST /auth/register/.
 *
 * The extension registration flow (spec section 4.4) does not auto-login
 * after register — it redirects to the extension-ready page which writes
 * an auth signal. This function is therefore intentionally separate from
 * login() rather than combining them.
 *
 * @throws  If the email is already taken (backend returns 400 with field errors).
 */
export async function register(
    email: string,
    password: string
): Promise<DetailResponse> {
    const response = await fetch(`${BACKEND_BASE}/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) throw await buildApiError(response);
    return response.json() as Promise<DetailResponse>;
}

/**
 * Logs in with email + password via POST /auth/token/.
 *
 * On success, stores the access token, refresh token, and has_api_key flag
 * in chrome.storage.local so the rest of the extension can read auth state
 * without further network calls.
 *
 * @throws  On invalid credentials (401) or network error.
 */
export async function login(
    email: string,
    password: string
): Promise<TokenPairResponse> {
    const response = await fetch(`${BACKEND_BASE}/auth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) throw await buildApiError(response);

    const data = (await response.json()) as TokenPairResponse;

    // Persist everything the extension needs to operate offline (auth state
    // checks, request decoration) without further network calls.
    await storeAuthData({
        jwt: data.access,
        refresh_token: data.refresh,
        has_api_key: data.user.has_claude_api_key,
        user_email: data.user.email,
    });

    return data;
}

// ---------------------------------------------------------------------------
// User settings endpoints
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's settings via GET /auth/user/settings/.
 *
 * Also syncs `has_claude_api_key` into chrome.storage.local so that
 * auth state derived from storage remains accurate after the panel loads.
 */
export async function getUserSettings(): Promise<UserSettingsResponse> {
    const data = await apiFetch<UserSettingsResponse>("/auth/user/settings/");
    await syncUserSettings(data);
    return data;
}

/**
 * Saves or updates the user's Claude API key via PUT /auth/user/claude-api-key/.
 *
 * The backend encrypts the key with Fernet before persisting it — the
 * plaintext never hits the database. The response includes the updated
 * UserSettingsSchema so we can immediately reflect `has_claude_api_key: true`
 * in local storage, transitioning the auth state to READY.
 *
 * Per spec section 4.8: after saving, commentary generation must begin
 * immediately — the caller is responsible for triggering that flow once this
 * resolves successfully.
 *
 * @throws  If the key fails server-side validation (e.g. empty string).
 */
export async function saveClaudeApiKey(
    apiKey: string
): Promise<UserSettingsResponse> {
    const data = await apiFetch<UserSettingsResponse>(
        "/auth/user/claude-api-key/",
        {
            method: "PUT",
            body: JSON.stringify({ claude_api_key: apiKey.trim() }),
        }
    );

    // Immediately update local storage so deriveAuthState() returns READY
    // without waiting for the next getUserSettings() call.
    await syncUserSettings(data);

    return data;
}

// ---------------------------------------------------------------------------
// Commentary endpoint
// ---------------------------------------------------------------------------

/**
 * Fetches the raw SGF text for an OGS game from the OGS REST API.
 *
 * This is a prerequisite step before calling generateCommentary() — the
 * backend expects the SGF content as a string, not a game ID.
 *
 * The OGS endpoint is unauthenticated for finished public games, so no
 * auth header is needed.
 *
 * @throws  If the game does not exist or the OGS API is unreachable.
 */
export async function fetchOgsSgf(gameId: number): Promise<string> {
    const response = await fetch(`${OGS_API_BASE}/games/${gameId}/sgf`);

    if (!response.ok) {
        throw new Error(
            `Could not fetch SGF for game ${gameId} from OGS (HTTP ${response.status}).`
        );
    }

    // The OGS SGF endpoint returns plain text, not JSON
    return response.text();
}

/**
 * Sends an SGF to the backend for KataGo analysis and Claude commentary
 * generation via POST /api/commentary/.
 *
 * The two-pass KataGo pipeline runs server-side (Pass 1: fast winrate scan
 * of all moves; Pass 2: deep analysis of the worst N moves). This call may
 * take 30–90 seconds for a full 19×19 game, so callers should show the
 * Generating state (spec section 4.6) while awaiting the response.
 *
 * Default request values mirror DEFAULT_COMMENTARY_CONFIG in the frontend,
 * keeping behaviour consistent between the web app and the extension.
 *
 * @param sgfContent  Raw SGF string fetched via fetchOgsSgf().
 * @param gameId      Used as the filename sent to the backend — lets the
 *                    backend log which OGS game was analysed.
 * @param overrides   Optional partial config to override any defaults.
 * @throws            On backend error (e.g. KataGo timeout, invalid SGF, bad API key).
 */
export async function generateCommentary(
    sgfContent: string,
    gameId: number,
    overrides: Partial<
        Omit<GenerateCommentaryRequest, "sgf_content" | "sgf_file_name">
    > = {}
): Promise<GenerateCommentaryResponse> {
    const request: GenerateCommentaryRequest = {
        sgf_content: sgfContent,
        sgf_file_name: `ogs_${gameId}.sgf`,
        model: "claude-haiku-4-5",
        language: "english",
        num_comments: 20,
        max_token: 1024,
        custom_instruction: "",
        ...overrides,
    };

    return apiFetch<GenerateCommentaryResponse>("/api/commentary/", {
        method: "POST",
        body: JSON.stringify(request),
    });
}
