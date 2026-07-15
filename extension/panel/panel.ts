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
    "screen-generating",
    "screen-commentary",
    "screen-error",
    "screen-waiting",
] as const;

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

// Reflect the current stored auth state into the panel: welcome when signed
// in, otherwise the default demo screen.
async function syncAuthState(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const auth = stored[STORAGE_KEY];
    if (isAuthObject(auth)) {
        renderWelcome(auth);
    } else {
        showScreen("screen-demo");
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

// Keep the panel in sync when auth is written/cleared elsewhere (e.g. the
// content script authenticates while this panel is open).
function watchAuthState(): void {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !(STORAGE_KEY in changes)) {
            return;
        }
        const auth = changes[STORAGE_KEY].newValue;
        if (isAuthObject(auth)) {
            renderWelcome(auth);
        } else {
            showScreen("screen-demo");
        }
    });
}

function init(): void {
    initHeader();
    initDemoScreen();
    initWelcomeScreen();
    watchAuthState();
    void syncAuthState();
}

document.addEventListener("DOMContentLoaded", init);
