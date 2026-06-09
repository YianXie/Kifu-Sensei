/**
 * service-worker.ts
 *
 * The extension's background service worker. This is the only context in the
 * extension that can:
 *   - Open the Chrome Side Panel (content scripts cannot call sidePanel.open())
 *   - Execute scripts inside the kifu-sensei.ai/extension-ready tab to read
 *     its localStorage and detect when the user has just registered
 *   - Enumerate all open tabs to broadcast auth state changes
 *
 * ─── MANIFEST CHANGE REQUIRED ──────────────────────────────────────────────
 * This file requires two additional permissions that are NOT yet in
 * manifest.json. Add them to the "permissions" array:
 *
 *   "tabs"      — chrome.tabs.query() to find OGS tabs and the extension-ready
 *                 page; chrome.tabs.sendMessage() to broadcast to content scripts
 *   "scripting" — chrome.scripting.executeScript() to read localStorage on the
 *                 extension-ready tab (kifu-sensei.ai is already in host_permissions
 *                 so no additional host permission is needed)
 *
 * ─── MV3 SERVICE WORKER LIFECYCLE NOTE ─────────────────────────────────────
 * Chrome may terminate an idle service worker after ~30 seconds of inactivity.
 * setInterval() does not survive termination. To keep the worker alive during
 * the brief auth signal polling window (~3–5 seconds), we perform a no-op
 * chrome.storage.local read on a separate interval, which constitutes API
 * activity that Chrome recognizes as "active". A maximum polling timeout of
 * 5 minutes is enforced to prevent the worker from running indefinitely if
 * something goes wrong.
 */

import {
    deriveAuthState,
    getStoredAuth,
    isAccessTokenExpired,
    refreshAccessToken,
    storeAuthData,
    syncUserSettings,
} from "../shared/auth";

import { getUserSettings } from "../shared/api";

import { type AuthState, type ExtensionMessage } from "../shared/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The localStorage key the kifu-sensei.ai/extension-ready page writes to. */
const AUTH_SIGNAL_KEY = "kifu_extension_auth";

/** How often (ms) we check the extension-ready tab for the auth signal. */
const POLL_INTERVAL_MS = 500;

/**
 * How long (ms) a signal is considered fresh. Signals older than this are
 * cleared and ignored — they likely belong to a previous, abandoned flow.
 */
const SIGNAL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Hard cap on polling duration. If no signal is detected within this window,
 * we stop polling and let the user re-trigger the flow manually.
 */
const POLL_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/** How often (ms) we ping chrome.storage to keep the service worker alive. */
const KEEP_ALIVE_INTERVAL_MS = 20_000;

// ---------------------------------------------------------------------------
// Auth signal type
// ---------------------------------------------------------------------------

/**
 * Shape of the value written to localStorage by kifu-sensei.ai/extension-ready.
 * The page encodes both auth tokens and the originating game ID so that the
 * background worker can auto-trigger commentary on the correct game once auth
 * is complete (spec section 6.2).
 */
interface AuthSignal {
    access: string;
    refresh: string;
    gameId: number;
    /** Unix timestamp in milliseconds, set when the page writes the signal. */
    timestamp: number;
}

// ---------------------------------------------------------------------------
// Polling state
// ---------------------------------------------------------------------------
// These module-level variables persist for the lifetime of the service worker
// instance. If Chrome terminates and restarts the worker, they reset to null,
// which is safe — polling only re-starts when a new extension-ready tab loads.

let authPollInterval: ReturnType<typeof setInterval> | null = null;
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

/**
 * Fires once on first installation and on extension updates.
 *
 * On fresh install: opens the kifu-sensei.ai/welcome tab automatically.
 * This is the entry point described in spec section 3.2 ("Install event").
 * We check `details.reason` to avoid re-opening the tab on every update
 * or browser restart.
 */
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({
            url: "https://kifu-sensei.ai/welcome?source=extension",
        });
    }
});

/**
 * Fires when Chrome starts up (not on every service worker restart, only on
 * full browser launch). We use this to proactively refresh a near-expired
 * access token so the first OGS page load of the session doesn't hit a 401.
 */
chrome.runtime.onStartup.addListener(() => {
    void proactiveTokenRefresh();
});

/**
 * Checks if the stored access token is expired (or nearly so) and refreshes
 * it silently. If the refresh itself fails, auth data is cleared, which will
 * transition the user to UNAUTHENTICATED on their next page load.
 */
async function proactiveTokenRefresh(): Promise<void> {
    const { jwt } = await getStoredAuth();
    if (jwt && isAccessTokenExpired(jwt)) {
        await refreshAccessToken();
        // refreshAccessToken() calls clearAuthData() internally on failure,
        // so we don't need to handle that case here.
    }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/**
 * Central message dispatcher. Receives messages from content scripts and the
 * side panel, routes them to the appropriate async handler.
 *
 * IMPORTANT: We return `true` from this listener to keep the message channel
 * open while the async handler runs. Without this, the `await sendMessage()`
 * call in the content script would reject with "message port closed before
 * a response was received".
 */
chrome.runtime.onMessage.addListener(
    (
        message: ExtensionMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: { ok: boolean; error?: string }) => void
    ) => {
        if (message.type === "OPEN_SIDE_PANEL") {
            handleOpenSidePanel(message.payload.gameId, sender)
                .then(() => sendResponse({ ok: true }))
                .catch((err: unknown) => {
                    console.error(
                        "[Kifu-Sensei] Error handling OPEN_SIDE_PANEL:",
                        err
                    );
                    sendResponse({ ok: false, error: String(err) });
                });

            // Return true to signal we will call sendResponse asynchronously
            return true;
        }
    }
);

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

/**
 * Opens the Chrome Side Panel for the window the user is in and stores the
 * game ID so the panel can retrieve it on initialisation.
 *
 * Flow:
 *   1. Store `pending_game_id` in chrome.storage.local so the panel can read
 *      it on first render (handles the case where the panel takes time to load).
 *   2. Call chrome.sidePanel.open() using the window ID from the sender tab.
 *   3. After a short delay, also send a GAME_CONTEXT message directly to the
 *      panel — this handles the case where the panel is already open and
 *      needs to switch to a different game.
 */
async function handleOpenSidePanel(
    gameId: number,
    sender: chrome.runtime.MessageSender
): Promise<void> {
    // Step 1 — Persist game ID before opening the panel so the panel can read
    // it even if it initialises before we send the GAME_CONTEXT message below.
    await chrome.storage.local.set({ pending_game_id: gameId });

    // Step 2 — Open the side panel. chrome.sidePanel.open() requires a
    // windowId; we get it from the content script's sender tab.
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
        console.warn(
            "[Kifu-Sensei] OPEN_SIDE_PANEL received but sender has no windowId."
        );
        return;
    }

    await chrome.sidePanel.open({ windowId });

    // Step 3 — Send game context directly to the panel. We delay slightly to
    // give the panel HTML time to load and register its message listener.
    // If the panel is already open, this updates it immediately without delay.
    setTimeout(() => {
        chrome.runtime
            .sendMessage({
                type: "GAME_CONTEXT",
                payload: { gameId },
            } satisfies ExtensionMessage)
            .catch(() => {
                // The panel may not have registered its listener yet — this is
                // expected on first open. The panel will read pending_game_id
                // from chrome.storage.local as a fallback.
            });
    }, 400);
}

// ---------------------------------------------------------------------------
// Tab update listener (triggers auth signal polling)
// ---------------------------------------------------------------------------

/**
 * Watches for tabs that navigate to kifu-sensei.ai/extension-ready.
 *
 * When detected, starts the auth signal polling loop. This is the correct
 * trigger because polling should only run while that page is actually open —
 * there is no point polling at any other time.
 *
 * We listen for status === "complete" to ensure the page has fully loaded
 * and had a chance to write its auth signal to localStorage.
 */
chrome.tabs.onUpdated.addListener((_, changeInfo, tab) => {
    if (
        changeInfo.status === "complete" &&
        tab.url?.startsWith("https://kifu-sensei.ai/extension-ready")
    ) {
        startAuthPolling();
    }
});

// ---------------------------------------------------------------------------
// Auth signal polling
// ---------------------------------------------------------------------------

/**
 * Starts the 500ms polling loop that checks the extension-ready tab for the
 * auth signal written to localStorage after registration.
 *
 * Guards against double-invocation: if polling is already running (e.g. the
 * user opened two extension-ready tabs), calling this again is a no-op.
 *
 * Also starts a keep-alive interval and a safety timeout that stops polling
 * after POLL_MAX_DURATION_MS regardless of outcome.
 */
function startAuthPolling(): void {
    if (authPollInterval !== null) return;

    console.log("[Kifu-Sensei] Auth signal polling started.");

    // Keep-alive: a chrome.storage read every 20 seconds counts as API
    // activity, preventing Chrome from terminating the service worker during
    // the polling window.
    keepAliveInterval = setInterval(() => {
        void chrome.storage.local.get("__keepalive");
    }, KEEP_ALIVE_INTERVAL_MS);

    // Main polling loop
    authPollInterval = setInterval(() => {
        void checkForAuthSignal();
    }, POLL_INTERVAL_MS);

    // Safety cap: stop polling after 5 minutes no matter what
    pollTimeoutId = setTimeout(() => {
        console.warn(
            "[Kifu-Sensei] Auth signal polling timed out after 5 minutes."
        );
        stopAuthPolling();
    }, POLL_MAX_DURATION_MS);
}

/**
 * Stops the auth signal polling loop and clears all associated timers.
 * Safe to call even if polling is not currently running.
 */
function stopAuthPolling(): void {
    if (authPollInterval !== null) {
        clearInterval(authPollInterval);
        authPollInterval = null;
    }

    if (keepAliveInterval !== null) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }

    if (pollTimeoutId !== null) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
    }

    console.log("[Kifu-Sensei] Auth signal polling stopped.");
}

/**
 * Looks for any open tab at kifu-sensei.ai/extension-ready and attempts to
 * read the auth signal from its localStorage.
 *
 * If no extension-ready tabs are found, stops polling — the page has already
 * closed (either auto-closed after 3 seconds, or the user closed it manually).
 *
 * If a valid, fresh signal is found, processes it and stops polling.
 */
async function checkForAuthSignal(): Promise<void> {
    const tabs = await chrome.tabs.query({
        url: "https://kifu-sensei.ai/extension-ready*",
    });

    if (tabs.length === 0) {
        // The extension-ready page is gone — no point continuing to poll
        stopAuthPolling();
        return;
    }

    for (const tab of tabs) {
        if (tab.id === undefined) continue;

        try {
            // Use chrome.scripting.executeScript to read localStorage in the
            // context of the extension-ready tab. This requires the "scripting"
            // permission and that kifu-sensei.ai/* is in host_permissions.
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                // This function runs inside the extension-ready page, not here.
                // It returns the raw string value, or null if the key is absent.
                // chrome-types declares func as () => void; args are passed at runtime.
                func: ((key: string) =>
                    localStorage.getItem(key)) as unknown as () => void,
                args: [AUTH_SIGNAL_KEY],
            });

            const rawSignal = results[0]?.result;
            if (!rawSignal) continue; // Key not written yet — keep polling

            // Parse and validate the signal
            let signal: AuthSignal;
            try {
                signal = JSON.parse(rawSignal) as AuthSignal;
            } catch {
                console.warn(
                    "[Kifu-Sensei] Received malformed auth signal — ignoring."
                );
                continue;
            }

            // Check freshness: stale signals (from a previous abandoned flow)
            // are cleared and ignored rather than processed.
            const age = Date.now() - signal.timestamp;
            if (age > SIGNAL_MAX_AGE_MS) {
                console.warn(
                    `[Kifu-Sensei] Auth signal is ${Math.round(age / 1000)}s old — discarding.`
                );
                // Clear the stale signal so it doesn't keep getting detected
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: ((key: string) =>
                        localStorage.removeItem(key)) as () => void,
                    args: [AUTH_SIGNAL_KEY],
                });
                continue;
            }

            // Valid signal found. Clear it from localStorage immediately to
            // prevent re-processing if the user returns to the page.
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: ((key: string) =>
                    localStorage.removeItem(key)) as () => void,
                args: [AUTH_SIGNAL_KEY],
            });

            // Process and stop — we only need to handle one signal per flow
            await processAuthSignal(signal);
            stopAuthPolling();
            return;
        } catch (err) {
            // Tab may have navigated away mid-check, or the page isn't ready
            // to accept script injection yet. Silently continue polling.
            console.warn(
                "[Kifu-Sensei] Error reading auth signal from tab:",
                err
            );
        }
    }
}

/**
 * Processes a successfully detected auth signal.
 *
 * Sequence:
 *   1. Store the access and refresh tokens in chrome.storage.local.
 *   2. Fetch GET /auth/user/settings/ to populate has_claude_api_key —
 *      this field is not in the auth signal, so we need a backend round-trip.
 *   3. Store pending_game_id so the panel knows which game to analyse.
 *   4. Derive the new auth state and broadcast AUTH_STATE_CHANGED to all
 *      OGS content script tabs (updates the injected button live).
 *   5. Send a GAME_CONTEXT message to the side panel to trigger generation.
 */
async function processAuthSignal(signal: AuthSignal): Promise<void> {
    console.log(
        `[Kifu-Sensei] Auth signal received. Game ID: ${signal.gameId}`
    );

    // Step 1 — Persist tokens. storeAuthData writes to chrome.storage.local.
    // We store tokens FIRST so the subsequent getUserSettings() call (which
    // reads the JWT from storage via apiFetch) can authenticate correctly.
    await storeAuthData({
        jwt: signal.access,
        refresh_token: signal.refresh,
    });

    // Step 2 — Fetch user settings from the backend to get has_claude_api_key.
    // getUserSettings() also calls syncUserSettings() internally, which writes
    // has_api_key into chrome.storage.local.
    try {
        const settings = await getUserSettings();
        await syncUserSettings(settings);
    } catch (err) {
        console.error(
            "[Kifu-Sensei] Failed to fetch user settings after auth signal:",
            err
        );
        // Non-fatal: has_api_key will be absent in storage, which deriveAuthState()
        // maps to AUTH_NO_KEY — correct for a brand new account.
    }

    // Step 3 — Store the game ID so the panel picks it up on first render
    // (in case the GAME_CONTEXT message below arrives before the panel is ready).
    await chrome.storage.local.set({ pending_game_id: signal.gameId });

    // Step 4 — Derive the new auth state and broadcast it so all OGS tabs
    // update their injected button without requiring a page reload.
    const newAuthState: AuthState = await deriveAuthState();
    await broadcastAuthStateChange(newAuthState);

    // Step 5 — Notify the panel of the game context so it can begin
    // the generating flow immediately.
    try {
        await chrome.runtime.sendMessage({
            type: "GAME_CONTEXT",
            payload: { gameId: signal.gameId },
        } satisfies ExtensionMessage);
    } catch {
        // Panel is not open — that's fine. The user will trigger it manually
        // by clicking the entry button, which will read pending_game_id.
    }
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Sends an AUTH_STATE_CHANGED message to every OGS tab that has a content
 * script running. Each content script listener calls updateButtonAuthState()
 * on receipt, switching the injected button to the correct variant.
 *
 * We use chrome.tabs.sendMessage (not chrome.runtime.sendMessage) because
 * content scripts are tab-specific. Tabs that don't have the content script
 * running (e.g. non-game pages) will produce a "Could not establish
 * connection" error, which we silently swallow.
 */
async function broadcastAuthStateChange(authState: AuthState): Promise<void> {
    const tabs = await chrome.tabs.query({
        url: "https://online-go.com/game/*",
    });

    const message: ExtensionMessage = {
        type: "AUTH_STATE_CHANGED",
        payload: { authState },
    };

    // Send in parallel — we don't need to wait for each tab in sequence
    await Promise.allSettled(
        tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) =>
                chrome.tabs.sendMessage(tab.id!, message).catch(() => {
                    // Content script not present on this tab (e.g. live game,
                    // injection guard prevented injection). Expected and harmless.
                })
            )
    );

    console.log(
        `[Kifu-Sensei] Broadcast AUTH_STATE_CHANGED (${authState}) to ${tabs.length} OGS tab(s).`
    );
}
