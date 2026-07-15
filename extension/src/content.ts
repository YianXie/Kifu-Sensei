import { ENDPOINTS } from "./shared/config";
import type { ExtensionAuthObject } from "./shared/types";

const MESSAGE_SOURCE = "kifu-sensei-inject";
const MESSAGE_TYPE = "extension_auth_update";
const STORAGE_KEY = "extension_auth";
// Refresh token of a session the user explicitly signed out of. The website
// leaves the old extension_auth in its own localStorage, so without this a
// freshly loaded frontend tab would re-deliver it and silently sign the user
// back in. Set by the panel's sign-out handler.
const REVOKED_KEY = "revoked_refresh_token";

// The access token most recently persisted, used to skip re-validating an
// identical update (checkStorage polls and can re-emit the same value).
let authenticatedToken: string | null = null;

function isAuthUpdateMessage(data: unknown): data is {
    source: typeof MESSAGE_SOURCE;
    type: typeof MESSAGE_TYPE;
    detail: ExtensionAuthObject | null;
} {
    if (typeof data !== "object" || data === null) {
        return false;
    }

    const message = data as Record<string, unknown>;
    return (
        message.source === MESSAGE_SOURCE &&
        message.type === MESSAGE_TYPE &&
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

// Exchanges a refresh token for a fresh token pair, or null if it is rejected.
async function refreshTokens(
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
        console.error(
            "[Kifu-Sensei content] Token refresh request failed:",
            error
        );
        return null;
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
        await chrome.storage.local.remove(STORAGE_KEY);
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
    const revoked = await chrome.storage.local.get(REVOKED_KEY);
    if (revoked[REVOKED_KEY] === refreshToken) {
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

    await chrome.storage.local.set({ [STORAGE_KEY]: verified });
    await chrome.storage.local.remove(REVOKED_KEY);
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
