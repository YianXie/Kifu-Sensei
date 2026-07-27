import {
    authedFetch,
    clearStoredAuth,
    getCurrentAuth,
    isAuthObject,
    readErrorResponse,
    setCurrentAuth,
} from "../src/shared/api";
import { ENDPOINTS, FRONTEND_URL } from "../src/shared/config";
import {
    AUTH_STORAGE_KEY,
    OGS_GAMES_URL,
    REVOKED_AUTH_KEY,
} from "../src/shared/constants";
import { checkOgsGame, type OgsGameCheck } from "../src/shared/ogs";
import type { ExtensionAuthObject } from "../src/shared/types";

// Frontend origins where the website may hold a stale extension_auth entry.
// Wildcarded because production serves the app from www — the bare apex only
// redirects there — and `*.` also covers the apex itself.
const FRONTEND_MATCHES = [
    "http://localhost:5173/*",
    "https://*.kifu-sensei.ai/*",
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

type ScreenId = (typeof SCREEN_IDS)[number];

let currentScreen: ScreenId | null = null;

// Guards against a slow game check overwriting a newer one: tab switches and SPA
// navigations can fire faster than OGS answers.
let gameCheckToken = 0;

function showScreen(id: ScreenId): void {
    currentScreen = id;
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

const WELCOME_LEAD_DEFAULT =
    "Your account is connected. Open a finished game and let Kifu-Sensei turn the key moments into plain-language commentary.";

function renderWelcome(auth: ExtensionAuthObject, game?: OgsGameCheck): void {
    const leadEl = document.getElementById("welcome-lead");
    if (leadEl) {
        leadEl.textContent =
            game?.state === "ready"
                ? `Game ${game.gameId} has finished and is ready to review.`
                : WELCOME_LEAD_DEFAULT;
    }
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

/**
 * Copy for every state that is *not* ready to review.
 *
 * `ready` is excluded from the parameter type and there is no `default`, so adding a
 * state to `OgsGameCheck` without giving it wording here is a compile error rather
 * than a silent fall-through to generic text.
 */
function waitingMessage(
    check: Exclude<OgsGameCheck, { state: "ready" } | { state: "no-game" }>
): string {
    switch (check.state) {
        case "unfinished":
            return check.phase === "stone removal"
                ? "This game is being scored. Kifu-Sensei can review it once it finishes."
                : "This game is still in progress. Kifu-Sensei can review it once it finishes.";
        case "unavailable":
            if (check.reason === "not-found") {
                return "That game could not be found on online-go.com.";
            }
            if (check.reason === "forbidden") {
                return "That game is private, so Kifu-Sensei cannot read it.";
            }
            return "Kifu-Sensei could not read this game's details from online-go.com.";
        case "offline":
            return "Could not reach online-go.com. Check your connection and try again.";
    }
}

// ── Running a review ────────────────────────────────────────────────────────

/**
 * Re-evaluate the active tab. Only redraws the two game-dependent screens, so a
 * navigation cannot yank the user out of the API-key flow.
 */
async function refreshGameState(): Promise<void> {
    if (
        currentScreen !== "screen-welcome" &&
        currentScreen !== "screen-waiting"
    ) {
        return;
    }
    const auth = getCurrentAuth();
    if (auth === null) {
        return;
    }
    await renderSignedIn(auth);
}

/**
 * Decide what a signed-in user sees, based on the game in the active tab.
 *
 * Guarded by a token because the user can switch tabs while the OGS lookup is in
 * flight; a stale result must not overwrite a newer one.
 */
async function renderSignedIn(auth: ExtensionAuthObject): Promise<void> {
    const token = ++gameCheckToken;
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    const check = await checkOgsGame(tab?.url);
    if (token !== gameCheckToken) {
        return; // A newer check started while this one was in flight.
    }

    if (check.state === "no-game") {
        // Not looking at a game: the welcome screen is the signed-in home, and the
        // only route to sign-out.
        renderWelcome(auth);
        return;
    }
    if (check.state === "ready") {
        renderWelcome(auth, check);
        return;
    }

    const textEl = document.getElementById("waiting-text");
    if (textEl) {
        textEl.textContent = waitingMessage(check);
    }
    showScreen("screen-waiting");
}

// Drops the stored session and returns the panel to the signed-out screen.
async function handleDeadSession(): Promise<void> {
    await clearStoredAuth();
    showScreen("screen-demo");
}

// Reflect the current stored auth state into the panel. Signed-out users get
// the demo screen; signed-in users get the key-entry screen or the welcome
// screen depending on whether their account already has a Claude API key.
// Runs on every panel open, so the key state can't go stale between sessions.
async function syncAuthState(): Promise<void> {
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    if (!isAuthObject(auth)) {
        setCurrentAuth(null);
        showScreen("screen-demo");
        return;
    }
    setCurrentAuth(auth);

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
        await renderSignedIn(auth);
        return;
    }

    let settings: {
        has_claude_api_key?: unknown;
        preferences?: Record<string, unknown>;
    };
    try {
        settings = (await response.json()) as typeof settings;
    } catch (error) {
        console.error(
            "[Kifu-Sensei panel] Malformed settings response:",
            error
        );
        await renderSignedIn(auth);
        return;
    }

    if (settings.has_claude_api_key === true) {
        await renderSignedIn(auth);
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
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    if (isAuthObject(auth)) {
        await chrome.storage.local.set({
            [REVOKED_AUTH_KEY]: auth.refreshToken,
        });
    }
    // Clearing the stored session flips the panel back to the demo screen via
    // the storage-change listener.
    await clearStoredAuth();
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
        const { detail } = await readErrorResponse(
            response,
            "Could not save your API key. Please try again."
        );
        showApiKeyError(detail);
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

    document
        .getElementById("accordion-toggle")
        ?.addEventListener("click", () => {
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
        if (area !== "local" || !(AUTH_STORAGE_KEY in changes)) {
            return;
        }
        const { newValue, oldValue } = changes[AUTH_STORAGE_KEY];
        if (!isAuthObject(newValue)) {
            setCurrentAuth(null);
            showScreen("screen-demo");
            return;
        }
        setCurrentAuth(newValue);
        // A token rotation (signed in both before and after) must not yank the
        // user out of the key-entry or key-saved screen, so only a fresh
        // sign-in re-runs the sync.
        if (!isAuthObject(oldValue)) {
            void syncAuthState();
        }
    });
}

function watchActiveTab(): void {
    chrome.tabs.onActivated.addListener(() => void refreshGameState());
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
        // OGS is a single-page app: moving between games fires onUpdated with a new
        // url and no page load, which is the only signal the panel gets.
        if (changeInfo.url !== undefined && tab.active) {
            void refreshGameState();
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
    watchActiveTab();
    void syncAuthState();
}

document.addEventListener("DOMContentLoaded", init);
