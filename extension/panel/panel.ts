import { ENDPOINTS } from "../src/shared/config";
import type { ExtensionAuthObject } from "../src/shared/types";

const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL;
const OGS_GAMES_URL = "https://online-go.com/observe-games/";
const STORAGE_KEY = "extension_auth";
// Marker read by the content script so a signed-out session isn't picked up
// again from the website's localStorage. Keep in sync with content.ts.
const REVOKED_KEY = "revoked_refresh_token";
// Frontend origins where the website may hold a stale extension_auth entry.
const FRONTEND_MATCHES = [
    "http://localhost:5173/*",
    "https://kifu-sensei.ai/*",
];

// Every top-level screen id, so we can flip to exactly one at a time.
const SCREEN_IDS = [
    "screen-demo",
    "screen-welcome",
    "screen-api-key",
    "screen-key-saved",
    "screen-generating",
    "screen-commentary",
    "screen-error",
    "screen-waiting",
] as const;

// Anthropic keys look like `sk-ant-api03-…`. Used only to show the reassuring
// format hint — the real check is the backend accepting the key.
const API_KEY_HINT_PATTERN = /^sk-ant-\S{16,}$/;

// The session backing the requests this panel makes. Kept in sync with
// chrome.storage.local so a refresh mid-flow doesn't strand us on a dead token.
let currentAuth: ExtensionAuthObject | null = null;

function showScreen(id: (typeof SCREEN_IDS)[number]): void {
    for (const screenId of SCREEN_IDS) {
        document
            .getElementById(screenId)
            ?.classList.toggle("hidden", screenId !== id);
    }
}

// Best-effort extraction of the account email from the JWT payload so the
// welcome screen can greet the user. Never throws — a missing/odd token just
// yields null and the email line stays hidden.
function decodeEmailFromToken(accessToken: string): string | null {
    try {
        const payload = accessToken.split(".")[1];
        if (!payload) {
            return null;
        }
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(
            base64.length + ((4 - (base64.length % 4)) % 4),
            "="
        );
        const claims = JSON.parse(atob(padded)) as { email?: unknown };
        return typeof claims.email === "string" ? claims.email : null;
    } catch {
        return null;
    }
}

function renderWelcome(auth: ExtensionAuthObject): void {
    const emailEl = document.getElementById("welcome-email");
    const email = decodeEmailFromToken(auth.accessToken);
    if (emailEl) {
        if (email) {
            emailEl.textContent = email;
            emailEl.classList.remove("hidden");
        } else {
            emailEl.textContent = "";
            emailEl.classList.add("hidden");
        }
    }
    showScreen("screen-welcome");
}

function isAuthObject(value: unknown): value is ExtensionAuthObject {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as ExtensionAuthObject).accessToken === "string"
    );
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
        console.error("[Kifu-Sensei panel] Token refresh failed:", error);
        return null;
    }
}

// Sends an authenticated request, retrying once with a refreshed token on 401.
// Returns null when the backend is unreachable, so callers can tell "offline"
// apart from a 401 meaning the session is genuinely dead.
async function authedFetch(
    url: string,
    init: RequestInit = {}
): Promise<Response | null> {
    if (currentAuth === null) {
        return null;
    }

    const send = (token: string): Promise<Response> =>
        fetch(url, {
            ...init,
            headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });

    try {
        const response = await send(currentAuth.accessToken);
        if (response.status !== 401) {
            return response;
        }

        const refreshed = await refreshTokens(currentAuth.refreshToken);
        if (refreshed === null) {
            // The refresh token is dead too; let the caller handle the 401.
            return response;
        }
        currentAuth = refreshed;
        await chrome.storage.local.set({ [STORAGE_KEY]: refreshed });
        return await send(refreshed.accessToken);
    } catch (error) {
        console.error("[Kifu-Sensei panel] Request failed:", url, error);
        return null;
    }
}

// Drops the stored session and returns the panel to the signed-out screen.
async function handleDeadSession(): Promise<void> {
    currentAuth = null;
    await chrome.storage.local.remove(STORAGE_KEY);
    showScreen("screen-demo");
}

// Reflect the current stored auth state into the panel. Signed-out users get
// the demo screen; signed-in users get the key-entry screen or the welcome
// screen depending on whether their account already has a Claude API key.
// Runs on every panel open, so the key state can't go stale between sessions.
async function syncAuthState(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const auth = stored[STORAGE_KEY];
    if (!isAuthObject(auth)) {
        currentAuth = null;
        showScreen("screen-demo");
        return;
    }
    currentAuth = auth;

    const response = await authedFetch(ENDPOINTS.userSettings);
    if (response === null || !response.ok) {
        if (response?.status === 401) {
            await handleDeadSession();
            return;
        }
        // Backend unreachable or erroring: don't guess at the key state and
        // don't nag a user who may already have a key. Commentary is gated
        // server-side regardless, so the welcome screen is the safe landing.
        console.warn(
            "[Kifu-Sensei panel] Could not read user settings; assuming a key is set."
        );
        renderWelcome(currentAuth);
        return;
    }

    let settings: { has_claude_api_key?: unknown };
    try {
        settings = (await response.json()) as { has_claude_api_key?: unknown };
    } catch (error) {
        console.error("[Kifu-Sensei panel] Malformed settings response:", error);
        renderWelcome(currentAuth);
        return;
    }

    if (settings.has_claude_api_key === true) {
        renderWelcome(currentAuth);
    } else {
        showApiKeyScreen();
    }
}

function initHeader(): void {
    document.getElementById("btn-close")?.addEventListener("click", () => {
        window.close();
    });
}

function initDemoScreen(): void {
    document.getElementById("btn-register")?.addEventListener("click", () => {
        chrome.tabs.create({
            url: `${FRONTEND_URL}/register?source=extension`,
        });
    });
    document.getElementById("btn-login")?.addEventListener("click", () => {
        chrome.tabs.create({
            url: `${FRONTEND_URL}/login?source=extension`,
        });
    });
}

// Remove the website's stale extension_auth from every open frontend tab so it
// can't re-authenticate the extension after sign-out. Best-effort: tabs that
// aren't open now are covered by the content script's revoked-session check.
async function clearWebsiteAuth(): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({ url: FRONTEND_MATCHES });
        await Promise.all(
            tabs.map((tab) => {
                if (tab.id === undefined) {
                    return Promise.resolve();
                }
                return chrome.scripting
                    .executeScript({
                        target: { tabId: tab.id },
                        func: () => localStorage.removeItem("extension_auth"),
                    })
                    .catch((error) => {
                        console.warn(
                            "[Kifu-Sensei panel] Could not clear extension_auth on tab",
                            tab.id,
                            error
                        );
                    });
            })
        );
    } catch (error) {
        console.warn("[Kifu-Sensei panel] clearWebsiteAuth failed:", error);
    }
}

async function signOut(): Promise<void> {
    // Record the session being revoked so the content script won't re-adopt it
    // from any lingering website localStorage entry.
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const auth = stored[STORAGE_KEY];
    if (isAuthObject(auth)) {
        await chrome.storage.local.set({ [REVOKED_KEY]: auth.refreshToken });
    }
    // Clearing the stored session flips the panel back to the demo screen via
    // the storage-change listener.
    await chrome.storage.local.remove(STORAGE_KEY);
    await clearWebsiteAuth();
}

function initWelcomeScreen(): void {
    document.getElementById("btn-open-ogs")?.addEventListener("click", () => {
        chrome.tabs.create({ url: OGS_GAMES_URL });
    });
    document
        .getElementById("btn-signout")
        ?.addEventListener("click", () => void signOut());
}

function keyInput(): HTMLInputElement | null {
    return document.getElementById("input-api-key") as HTMLInputElement | null;
}

function saveKeyButton(): HTMLButtonElement | null {
    return document.getElementById("btn-save-key") as HTMLButtonElement | null;
}

function showApiKeyError(message: string): void {
    const errorEl = document.getElementById("apikey-error");
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove("hidden");
    }
}

function hideApiKeyError(): void {
    document.getElementById("apikey-error")?.classList.add("hidden");
}

// Mirror the typed key into the submit button and the format hint. The button
// only needs a non-empty key — the hint is the softer signal, so an unexpected
// key shape never hard-blocks a user whose key is actually fine.
function syncKeyFieldState(): void {
    const input = keyInput();
    if (input === null) {
        return;
    }
    const key = input.value.trim();
    const looksValid = API_KEY_HINT_PATTERN.test(key);

    const button = saveKeyButton();
    if (button) {
        button.disabled = key.length === 0;
    }
    input.classList.toggle("field-input--valid", looksValid);
    document
        .getElementById("key-valid-hint")
        ?.classList.toggle("hidden", !looksValid);
}

function showApiKeyScreen(): void {
    const input = keyInput();
    if (input) {
        input.value = "";
    }
    hideApiKeyError();
    syncKeyFieldState();
    showScreen("screen-api-key");
}

// Pulls a human-readable message out of a failed save. The backend returns
// either {"detail": "…"} or DRF-style {"field": ["…"]}.
async function readApiKeyError(response: Response): Promise<string> {
    const fallback = "Could not save your API key. Please try again.";
    try {
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null) {
            return fallback;
        }
        const { detail, claude_api_key: fieldErrors } = body as {
            detail?: unknown;
            claude_api_key?: unknown;
        };
        if (typeof detail === "string" && detail) {
            return detail;
        }
        if (Array.isArray(fieldErrors) && typeof fieldErrors[0] === "string") {
            return fieldErrors[0];
        }
        return fallback;
    } catch {
        return fallback;
    }
}

function setSavingKey(saving: boolean): void {
    const button = saveKeyButton();
    if (button === null) {
        return;
    }
    button.disabled = saving;
    button.textContent = saving ? "Saving…" : "Save & Continue";
}

async function saveApiKey(): Promise<void> {
    const input = keyInput();
    const key = input?.value.trim();
    if (!key) {
        return;
    }

    hideApiKeyError();
    setSavingKey(true);
    const response = await authedFetch(ENDPOINTS.claudeApiKey, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claude_api_key: key }),
    });
    setSavingKey(false);

    if (response === null) {
        showApiKeyError(
            "Could not reach Kifu-Sensei. Check your connection and try again."
        );
        syncKeyFieldState();
        return;
    }
    if (response.status === 401) {
        await handleDeadSession();
        return;
    }
    if (!response.ok) {
        showApiKeyError(await readApiKeyError(response));
        syncKeyFieldState();
        return;
    }

    // Saved — don't leave the plaintext key sitting in the DOM.
    if (input) {
        input.value = "";
    }
    syncKeyFieldState();
    showScreen("screen-key-saved");
}

function initApiKeyScreen(): void {
    keyInput()?.addEventListener("input", () => {
        hideApiKeyError();
        syncKeyFieldState();
    });
    keyInput()?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            void saveApiKey();
        }
    });
    saveKeyButton()?.addEventListener("click", () => void saveApiKey());

    document.getElementById("accordion-toggle")?.addEventListener("click", () => {
        const body = document.getElementById("accordion-body");
        const isOpen = body?.classList.toggle("hidden") === false;
        document
            .getElementById("accordion-chevron")
            ?.classList.toggle("accordion-chevron--open", isOpen);
    });
}

function initKeySavedScreen(): void {
    document
        .getElementById("btn-saved-open-ogs")
        ?.addEventListener("click", () => {
            chrome.tabs.create({ url: OGS_GAMES_URL });
        });
}

// Keep the panel in sync when auth is written/cleared elsewhere (e.g. the
// content script authenticates while this panel is open).
function watchAuthState(): void {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !(STORAGE_KEY in changes)) {
            return;
        }
        const { newValue, oldValue } = changes[STORAGE_KEY];
        if (!isAuthObject(newValue)) {
            currentAuth = null;
            showScreen("screen-demo");
            return;
        }
        currentAuth = newValue;
        // A token rotation (signed in both before and after) must not yank the
        // user out of the key-entry or key-saved screen, so only a fresh
        // sign-in re-runs the sync.
        if (!isAuthObject(oldValue)) {
            void syncAuthState();
        }
    });
}

function init(): void {
    initHeader();
    initDemoScreen();
    initWelcomeScreen();
    initApiKeyScreen();
    initKeySavedScreen();
    watchAuthState();
    void syncAuthState();
}

document.addEventListener("DOMContentLoaded", init);
