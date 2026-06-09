/**
 * auth.ts
 *
 * All token lifecycle logic for the extension. This module owns every
 * read from and write to chrome.storage.local that concerns authentication.
 *
 * Responsibilities:
 *   - Reading and writing tokens + auth flags to chrome.storage.local
 *   - Checking whether the stored access token is still valid
 *   - Silently refreshing an expired access token
 *   - Deriving the current AuthState for any caller that needs it
 *   - Clearing all auth data on logout or refresh failure
 *
 * Nothing in this file touches the DOM or sends chrome.runtime messages.
 * It is a pure auth utility layer, usable from any extension context
 * (background worker, content script, or side panel).
 */

import {
    AuthStates,
    type AuthState,
    type ExtensionStorage,
    type UserSettingsResponse,
} from "./types";

// ---------------------------------------------------------------------------
// Storage constants
// ---------------------------------------------------------------------------

/** The keys this extension reads/writes in chrome.storage.local. */
const STORAGE_KEYS: (keyof ExtensionStorage)[] = [
    "jwt",
    "refresh_token",
    "has_api_key",
    "user_email",
];

/** Backend endpoint for token refresh. Defined here to avoid a circular
 *  dependency between auth.ts and api.ts (api.ts calls auth.ts for tokens;
 *  auth.ts must not import api.ts back). */
const TOKEN_REFRESH_URL = `${import.meta.env.VITE_API_URL ?? "https://api.kifu-sensei.ai"}/auth/token/refresh/`;

// ---------------------------------------------------------------------------
// Storage read / write
// ---------------------------------------------------------------------------

/**
 * Reads all auth-related keys from chrome.storage.local in a single call.
 * Returns a partial object — callers must handle missing keys gracefully.
 */
export async function getStoredAuth(): Promise<Partial<ExtensionStorage>> {
    return chrome.storage.local.get(STORAGE_KEYS) as Promise<
        Partial<ExtensionStorage>
    >;
}

/**
 * Persists auth data to chrome.storage.local after a successful login or
 * token refresh. Accepts a partial object so callers can update only the
 * fields that changed (e.g. a token refresh only updates `jwt` and
 * `refresh_token`, not `has_api_key`).
 */
export async function storeAuthData(
    data: Partial<ExtensionStorage>
): Promise<void> {
    await chrome.storage.local.set(data);
}

/**
 * Removes all auth data from chrome.storage.local.
 * Called on explicit logout, or when a token refresh fails and the user
 * must re-authenticate from scratch.
 */
export async function clearAuthData(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEYS);
}

// ---------------------------------------------------------------------------
// Token validity
// ---------------------------------------------------------------------------

/**
 * Decodes the payload section of a JWT and checks whether the `exp` claim
 * has passed, with a 30-second buffer to proactively refresh before the
 * server would actually reject it.
 *
 * We decode without verifying the signature — the signature check happens
 * server-side. Here we only care about the expiry timestamp so we can avoid
 * unnecessary 401 round-trips.
 *
 * Returns true (treat as expired) for any malformed token, so callers can
 * safely attempt a refresh rather than sending a known-bad token.
 */
export function isAccessTokenExpired(token: string): boolean {
    try {
        // JWT structure: base64url(header).base64url(payload).signature
        const payloadSegment = token.split(".")[1];

        // base64url uses - and _ instead of + and /; atob requires standard base64
        const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(base64)) as { exp: number };

        // 30-second buffer: refresh before the token actually expires
        return Date.now() / 1000 > payload.exp - 30;
    } catch {
        return true;
    }
}

// ---------------------------------------------------------------------------
// Silent token refresh
// ---------------------------------------------------------------------------

/**
 * Attempts to obtain a new access token using the stored refresh token.
 *
 * On success: updates `jwt` and `refresh_token` in chrome.storage.local
 * and returns the new access token string.
 *
 * On failure (expired refresh, network error, server error): clears all
 * auth data from storage (forcing re-login) and returns null.
 *
 * This function is called by api.ts when a backend request returns 401,
 * and by the background service worker on startup to pre-emptively refresh
 * a token that is about to expire.
 */
export async function refreshAccessToken(): Promise<string | null> {
    const { refresh_token } = await getStoredAuth();

    if (!refresh_token) {
        // Nothing to refresh — the user was never logged in or already cleared
        return null;
    }

    try {
        const response = await fetch(TOKEN_REFRESH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh: refresh_token }),
        });

        if (!response.ok) {
            // Refresh token is expired or revoked — user must log in again
            await clearAuthData();
            return null;
        }

        // The backend's AccessTokenResponse returns both access AND refresh tokens
        const data = (await response.json()) as {
            access: string;
            refresh: string;
        };

        await storeAuthData({
            jwt: data.access,
            refresh_token: data.refresh,
        });

        return data.access;
    } catch {
        // Network failure — don't clear storage, the user may just be offline.
        // Let the caller decide whether to show an error or retry.
        return null;
    }
}

// ---------------------------------------------------------------------------
// Auth state derivation
// ---------------------------------------------------------------------------

/**
 * Derives the current AuthState from chrome.storage.local.
 *
 * This is the canonical function for determining which UI state to show.
 * It checks storage only — no network calls. The background worker is
 * responsible for keeping storage in sync with the backend.
 *
 * Mapping (spec section 3.3):
 *   No jwt              → UNAUTHENTICATED
 *   jwt, no has_api_key → AUTH_NO_KEY
 *   jwt + has_api_key   → READY
 */
export async function deriveAuthState(): Promise<AuthState> {
    const { jwt, has_api_key } = await getStoredAuth();

    if (!jwt) return AuthStates.UNAUTHENTICATED;
    if (!has_api_key) return AuthStates.AUTH_NO_KEY;
    return AuthStates.READY;
}

// ---------------------------------------------------------------------------
// Convenience: sync user settings into storage
// ---------------------------------------------------------------------------

/**
 * Takes a UserSettingsResponse from the backend and writes the fields we
 * cache locally into chrome.storage.local. Called after login and after
 * saving a Claude API key, so that deriveAuthState() returns the correct
 * value without needing another network request.
 */
export async function syncUserSettings(
    settings: UserSettingsResponse
): Promise<void> {
    await storeAuthData({
        has_api_key: settings.has_claude_api_key,
    });
}
