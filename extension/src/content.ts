import { startButton } from "./button/controller";
import { refreshTokens } from "./shared/api";
import { ENDPOINTS, FRONTEND_URL } from "./shared/config";
import {
    AUTH_MESSAGE_SOURCE,
    AUTH_MESSAGE_TYPE,
    AUTH_STORAGE_KEY,
    OGS_ORIGIN,
    REVOKED_AUTH_KEY,
} from "./shared/constants";
import type { ExtensionAuthObject } from "./shared/types";

// This content script also runs on online-go.com (for the injected review button),
// so the auth handoff below must only ever trust messages from the frontend itself.
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin;

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
    // Logged, not alerted. This runs on the Kifu-Sensei website itself, so a
    // blocking native modal appeared on top of a page with its own toast system —
    // and the claim that it "only fires on a genuine authentication failure" was
    // not true: every fetch error was read as one, so a momentary offline blip
    // told the user to log in again.
    //
    // Nothing is lost by not shouting. A handoff that does not complete leaves the
    // panel on its signed-out screen, which says what to do, and `inject.ts` keeps
    // polling so a recovered connection completes it without the user doing
    // anything.
    console.warn(`[Kifu-Sensei content] ${message}`);
}

// Confirms the access token is currently accepted by the backend.
//
// This is the one API call made from the content script rather than an extension
// context. It is safe only because it runs on the frontend origins, which the
// backend's CORS allowlist covers — the same request from online-go.com would be
// blocked. Anything else that talks to the API belongs in the panel or the worker.
type TokenCheck = "valid" | "rejected" | "unreachable";

async function checkAccessToken(accessToken: string): Promise<TokenCheck> {
    try {
        const response = await fetch(ENDPOINTS.userSettings, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return response.ok ? "valid" : "rejected";
    } catch (error) {
        // Distinguished from a rejection rather than folded into one. This used to
        // return false for any thrown error, so being offline for a moment was
        // indistinguishable from a revoked token — the same conflation
        // `AuthContext` was deliberately fixed not to make.
        console.warn(
            "[Kifu-Sensei content] Could not reach the backend to verify the session:",
            error
        );
        return "unreachable";
    }
}

/**
 * A verified (possibly refreshed) token pair, or why it could not be verified.
 *
 * `"unreachable"` is not a failure to report — the tokens may be perfectly good.
 */
async function authorize(
    auth: ExtensionAuthObject
): Promise<ExtensionAuthObject | "rejected" | "unreachable"> {
    const check = await checkAccessToken(auth.accessToken);
    if (check === "valid") {
        return auth;
    }
    if (check === "unreachable") {
        return "unreachable";
    }
    // The access token is expired or revoked; fall back to the refresh token.
    return (await refreshTokens(auth.refreshToken)) ?? "rejected";
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
    if (verified === "unreachable") {
        // Leave `authenticatedToken` unset so the next poll tries again once the
        // connection is back, rather than treating this as settled.
        notifyUser(
            "Could not reach Kifu-Sensei to verify the sign-in; will retry."
        );
        return;
    }
    if (verified === "rejected") {
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
    if (event.origin !== FRONTEND_ORIGIN || event.source !== window) {
        return;
    }

    if (!isAuthUpdateMessage(event.data)) {
        return;
    }

    void handleAuthUpdate(event.data.detail);
});

// inject.ts's only job is relaying the frontend's own localStorage to the message
// listener above, so it belongs only on the frontend origin — injecting it into
// online-go.com would just be a script running there for no reason.
if (location.origin === FRONTEND_ORIGIN) {
    injectPageScript();
} else if (location.origin === OGS_ORIGIN) {
    // The button belongs only on online-go.com. On the Kifu-Sensei frontend origins
    // this script exists solely for the auth handoff above.
    void startButton();
}
