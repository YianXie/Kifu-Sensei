/**
 * index.ts
 *
 * Orchestration layer. This is the content script entry point — the first
 * file Chrome executes when the user lands on online-go.com/game/*.
 *
 * Responsibilities:
 *   1. Patch the History API so we can detect SPA navigation (OGS is a
 *      React app that changes routes without full page reloads).
 *   2. On every navigation to a game page, run the injection guard:
 *        a. Parse the game ID from the URL.
 *        b. Fetch game data from OGS to verify phase === "finished".
 *        c. Read auth state from chrome.storage.local.
 *        d. Inject the entry button (or remove it if any check fails).
 *   3. Listen for AUTH_STATE_CHANGED messages from the background service
 *      worker so we can update the button live without a page reload.
 *
 * This file should contain no DOM manipulation (that's overlay.ts) and no
 * OGS API calls (that's ogs-bridge.ts). It wires them together.
 */

// import "../styles/overlay.css";
import { getGameIdFromUrl, fetchGameData, isSafeToInject } from "./ogs-bridge";
import {
    injectEntryButton,
    updateButtonAuthState,
    removeEntryButton,
} from "./overlay";
import { type AuthState, AuthStates } from "../shared/types";

// ---------------------------------------------------------------------------
// Auth state
// ---------------------------------------------------------------------------

/**
 * Derives the current AuthState from chrome.storage.local.
 *
 * The background service worker is responsible for writing these values when
 * the user authenticates or adds an API key. We read them here on each
 * navigation to decide which button variant to show.
 *
 * Storage schema:
 *   jwt          — string | undefined  — JWT access token
 *   has_api_key  — boolean | undefined — mirrors /api/v1/users/me/ response
 *
 * Per spec section 3.3:
 *   No jwt         → UNAUTHENTICATED
 *   jwt, no key    → AUTH_NO_KEY
 *   jwt + key      → READY
 */
async function getAuthState(): Promise<AuthState> {
    const { jwt, has_api_key } = await chrome.storage.local.get([
        "jwt",
        "has_api_key",
    ]);

    if (!jwt) return AuthStates.UNAUTHENTICATED;
    if (!has_api_key) return AuthStates.AUTH_NO_KEY;
    return AuthStates.READY;
}

// ---------------------------------------------------------------------------
// Button click handler
// ---------------------------------------------------------------------------

/**
 * Called when the user clicks the injected entry button.
 *
 * We can't call chrome.sidePanel.open() directly from a content script
 * because it requires the window ID, which only the background context
 * knows reliably. Instead, we ask the background service worker to open
 * the panel on our behalf and pass it the game ID so the panel can
 * immediately begin the correct flow for this game.
 */
async function handleButtonClick(gameId: number): Promise<void> {
    await chrome.runtime.sendMessage({
        type: "OPEN_SIDE_PANEL",
        payload: { gameId },
    });
}

// ---------------------------------------------------------------------------
// Core injection logic
// ---------------------------------------------------------------------------

/**
 * The injection guard. Runs on every navigation to a game URL.
 *
 * This is the single function that decides whether Kifu-Sensei should be
 * visible on the current page. All three checks must pass:
 *
 *   1. A valid game ID is present in the URL.
 *   2. The OGS API confirms phase === "finished" and disable_analysis is false.
 *   3. (Implicit) We have a DOM anchor to inject into — handled inside
 *      injectEntryButton, which will log a warning and no-op if OGS's
 *      DOM structure has changed.
 *
 * If check 1 or 2 fails, we remove any previously injected button and return.
 * This handles the case where the user navigates from a finished game
 * to a live game in the same tab — the button disappears immediately.
 */
async function tryInject(): Promise<void> {
    // Step 1 — Is this a game URL at all?
    const gameId = getGameIdFromUrl();
    if (!gameId) {
        removeEntryButton();
        return;
    }

    // Step 2 — Is this game finished and analysis-safe?
    // fetchGameData returns null on network errors; isSafeToInject returns false
    // for live games. Either way, we must not inject.
    const gameData = await fetchGameData(gameId);
    if (!gameData || !isSafeToInject(gameData)) {
        removeEntryButton();
        return;
    }

    // Step 3 — Read auth state and inject the appropriate button variant
    const authState = await getAuthState();

    // Pass the click handler as a closure so overlay.ts stays stateless
    await injectEntryButton(authState, () => handleButtonClick(gameId));
}

// ---------------------------------------------------------------------------
// SPA navigation detection
// ---------------------------------------------------------------------------

/**
 * Patches the browser History API to fire a custom "ogs:navigate" event
 * whenever OGS changes the URL without a full page reload.
 *
 * OGS uses React Router, which calls history.pushState() on every internal
 * navigation. The browser's native "popstate" event only fires on
 * back/forward navigation, not on pushState calls, so we need to wrap
 * pushState and replaceState ourselves.
 *
 * This is the standard pattern for content scripts on React SPAs. We
 * dispatch a CustomEvent on `window` that our own listener picks up —
 * keeping the patch self-contained and not affecting OGS's own routing.
 */
function patchHistoryApiForSpaDetection(): void {
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (
        ...args: Parameters<typeof history.pushState>
    ) {
        originalPushState(...args);
        window.dispatchEvent(new CustomEvent("ogs:navigate"));
    };

    history.replaceState = function (
        ...args: Parameters<typeof history.replaceState>
    ) {
        originalReplaceState(...args);
        window.dispatchEvent(new CustomEvent("ogs:navigate"));
    };

    // Back/forward button navigations fire popstate, not pushState
    window.addEventListener("popstate", () => {
        window.dispatchEvent(new CustomEvent("ogs:navigate"));
    });
}

// ---------------------------------------------------------------------------
// Auth change listener
// ---------------------------------------------------------------------------

/**
 * Listens for AUTH_STATE_CHANGED messages from the background service worker.
 *
 * Flow this handles (spec section 4.5):
 *   1. Unauthenticated user clicks "Get AI Commentary" → side panel opens.
 *   2. User clicks "Create free account" → new tab opens on kifu-sensei.ai.
 *   3. User registers → kifu-sensei.ai/extension-ready writes auth signal
 *      to localStorage.
 *   4. Background service worker detects the signal, stores JWT in
 *      chrome.storage.local, and broadcasts AUTH_STATE_CHANGED to all tabs.
 *   5. THIS listener receives the broadcast and updates the button in the
 *      OGS tab the user left open — so when they return to OGS, the button
 *      already shows the activated "✔ Kifu-Sensei" state.
 */
function listenForAuthStateChanges(): void {
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "AUTH_STATE_CHANGED") {
            const newState: AuthState = message.payload.authState;
            updateButtonAuthState(newState);
        }
    });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Main function — called once when Chrome injects this content script.
 *
 * We patch the History API first (before any navigation can happen),
 * register the auth listener, then run the injection guard immediately
 * for the current page state.
 */
async function main(): Promise<void> {
    patchHistoryApiForSpaDetection();
    listenForAuthStateChanges();

    // Run the injection guard for the current page (handles direct loads and
    // hard refreshes to a game URL)
    await tryInject();

    // Re-run the injection guard on every SPA navigation.
    // The 250ms delay gives React time to commit the new route's DOM before
    // we start looking for the OGS anchor element. The MutationObserver in
    // overlay.ts provides an additional safety net if the DOM is still loading.
    window.addEventListener("ogs:navigate", () => {
        setTimeout(() => tryInject(), 250);
    });
}

main();
