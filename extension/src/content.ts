import { refreshTokens } from "./shared/api";
import { ENDPOINTS } from "./shared/config";
import {
    AUTH_MESSAGE_SOURCE,
    AUTH_MESSAGE_TYPE,
    AUTH_STORAGE_KEY,
    REVOKED_AUTH_KEY,
} from "./shared/constants";
import type { ExtensionAuthObject } from "./shared/types";

// The access token most recently persisted, used to skip re-validating an
// identical update (checkStorage polls and can re-emit the same value).
let authenticatedToken: string | null = null;

function isAuthUpdateMessage(data: unknown): data is {
    source: typeof AUTH_MESSAGE_SOURCE;
    type: typeof AUTH_MESSAGE_TYPE;
    detail: ExtensionAuthObject | null;
} {
    if (typeof data !== "object" || data === null) {
        return false;
    }

    const message = data as Record<string, unknown>;
    return (
        message.source === AUTH_MESSAGE_SOURCE &&
        message.type === AUTH_MESSAGE_TYPE &&
        (message.detail === null || typeof message.detail === "object")
    );
}

function injectPageScript(): void {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("dist/inject.js");
    script.onload = function () {
        (this as HTMLScriptElement).remove();
    };
    (document.head || document.documentElement).appendChild(script);
}

function notifyUser(message: string): void {
    console.warn(`[Kifu-Sensei content] ${message}`);
    // A blocking alert is the only user-facing notification channel available
    // from a content script without extra permissions. It only fires on a
    // genuine authentication failure, which is rare.
    window.alert(message);
}

// Confirms the access token is currently accepted by the backend.
//
// This is the one API call made from the content script rather than an extension
// context. It is safe only because it runs on the frontend origins, which the
// backend's CORS allowlist covers — the same request from online-go.com would be
// blocked. Anything else that talks to the API belongs in the panel or the worker.
async function isAccessTokenValid(accessToken: string): Promise<boolean> {
    try {
        const response = await fetch(ENDPOINTS.userSettings, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return response.ok;
    } catch (error) {
        console.error(
            "[Kifu-Sensei content] Token verification request failed:",
            error
        );
        return false;
    }
}

// Returns a verified (possibly refreshed) token pair, or null if the tokens
// cannot authenticate the user.
async function authorize(
    auth: ExtensionAuthObject
): Promise<ExtensionAuthObject | null> {
    if (await isAccessTokenValid(auth.accessToken)) {
        return auth;
    }
    // The access token is expired/invalid; fall back to the refresh token.
    return refreshTokens(auth.refreshToken);
}

async function handleAuthUpdate(
    updatedObject: ExtensionAuthObject | null
): Promise<void> {
    console.log(
        "[Kifu-Sensei content] Detected extension_auth update:",
        updatedObject
    );

    // The key was cleared (e.g. the user logged out): drop any stored session.
    if (updatedObject === null) {
        authenticatedToken = null;
        await chrome.storage.local.remove(AUTH_STORAGE_KEY);
        return;
    }

    const { accessToken, refreshToken } = updatedObject;
    if (
        typeof accessToken !== "string" ||
        typeof refreshToken !== "string" ||
        !accessToken ||
        !refreshToken
    ) {
        notifyUser(
            "Kifu-Sensei received malformed sign-in data and could not authenticate."
        );
        return;
    }

    // Already validated and stored this exact token; nothing to do.
    if (accessToken === authenticatedToken) {
        return;
    }

    // Don't silently re-authenticate a session the user signed out of. Only the
    // exact same session is blocked — a genuine re-login mints a new refresh
    // token, which passes this check and clears the marker below.
    const revoked = await chrome.storage.local.get(REVOKED_AUTH_KEY);
    if (revoked[REVOKED_AUTH_KEY] === refreshToken) {
        console.log(
            "[Kifu-Sensei content] Ignoring stale extension_auth from a signed-out session."
        );
        return;
    }

    const verified = await authorize(updatedObject);
    if (verified === null) {
        notifyUser(
            "Kifu-Sensei could not verify your sign-in. Please log in again."
        );
        return;
    }

    await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: verified });
    await chrome.storage.local.remove(REVOKED_AUTH_KEY);
    authenticatedToken = verified.accessToken;
    console.log(
        "[Kifu-Sensei content] Authenticated; tokens saved to chrome.storage.local."
    );
}

window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) {
        return;
    }

    if (!isAuthUpdateMessage(event.data)) {
        return;
    }

    void handleAuthUpdate(event.data.detail);
});

injectPageScript();
