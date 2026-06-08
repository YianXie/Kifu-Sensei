/**
 * overlay.ts
 *
 * DOM layer. Responsible for injecting and managing the Kifu-Sensei entry
 * button inside the OGS page. This file never fetches data or reads auth
 * state — it receives everything it needs as function arguments and
 * manipulates the DOM accordingly.
 *
 * The button is the only thing this file touches on the OGS page. The side
 * panel itself is a separate HTML surface owned by the background worker.
 */

import { type AuthState, AuthStates } from "../shared/types";

/** Stable ID for the injected button so we can find and remove it later. */
const BUTTON_ID = "kifu-sensei-entry-btn";

/**
 * CSS selectors for the OGS right-column element we anchor the button to.
 *
 * OGS is a living React application and its DOM structure changes between
 * releases. We try these selectors in order and use the first match. When
 * none match, we fall back to a broader sidebar selector. If that also
 * fails, we log a warning and skip injection for this page load — the
 * navigator listener will retry on the next route change.
 *
 * When OGS updates and breaks injection, this list is the first place to
 * look and update.
 */
const OGS_ANCHOR_SELECTORS = [
    ".ai-review-container",
    "[class*='AIReview']",
    ".analyze-tools",
    ".right-col-content",
    ".game-right-col",
    ".rightside-tools",
];

/**
 * Waits for an anchor element to appear in the DOM, up to `timeoutMs`.
 *
 * OGS renders asynchronously — when navigating between games, React may
 * not have committed the right-column DOM by the time our content script
 * runs. Rather than a fixed setTimeout, we use a MutationObserver that
 * resolves as soon as any matching element appears.
 *
 * Returns null if no anchor is found within the timeout window.
 */
function waitForAnchor(timeoutMs = 4000): Promise<Element | null> {
    // Check synchronously first — often the DOM is already there on hard reload
    for (const selector of OGS_ANCHOR_SELECTORS) {
        const el = document.querySelector(selector);
        if (el) return Promise.resolve(el);
    }

    // Not in DOM yet — observe mutations until it appears or we time out
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            for (const selector of OGS_ANCHOR_SELECTORS) {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                    return;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Give up after timeoutMs and resolve with null so the caller can bail
        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeoutMs);
    });
}

/**
 * Builds the button DOM element for a given auth state.
 *
 * The button has two visual variants (spec section 4.2):
 *   - UNAUTHENTICATED / AUTH_NO_KEY:  green dot  + "Get AI Commentary"
 *   - READY:                          checkmark  + "Kifu-Sensei"
 *
 * Styles are applied inline rather than via a class name to ensure complete
 * isolation from OGS's own stylesheet. We match OGS's Material-influenced
 * neutral palette so the button feels native, not like an advertisement.
 */
function buildButton(authState: AuthState): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.setAttribute("data-ks-auth-state", authState);

    const isReady = authState === AuthStates.READY;

    // Inner HTML uses a <span> for the icon so we can style it independently
    btn.innerHTML = isReady
        ? `<span data-ks-icon style="color:#2A6B4F">✔</span> Kifu-Sensei`
        : `<span data-ks-icon style="color:#2A6B4F;font-size:10px">●</span> Get AI Commentary`;

    // Base button styles — match OGS's button height and border-radius
    Object.assign(btn.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        width: "100%",
        height: "38px", // Spec: 36–40px to fit OGS column width
        margin: "8px 0",
        padding: "0 12px",
        border: "1px solid #E8E8E8", // --ks-light-gray from spec section 8.1
        borderRadius: "4px",
        background: "#FFFFFF",
        color: "#2D2D2D", // --ks-dark-gray
        fontSize: "13px",
        fontWeight: "600",
        fontFamily: "inherit", // Inherit OGS's system sans-serif stack
        cursor: "pointer",
        boxSizing: "border-box",
        transition: "background 0.15s ease",
    });

    // Hover state — deepen the background slightly to give tactile feedback
    btn.addEventListener("mouseenter", () => {
        btn.style.background = "#EAF4EF"; // --ks-accent-light
        btn.style.borderColor = "#2A6B4F"; // --ks-accent
    });
    btn.addEventListener("mouseleave", () => {
        btn.style.background = "#FFFFFF";
        btn.style.borderColor = "#E8E8E8";
    });

    return btn;
}

/**
 * Injects the Kifu-Sensei entry button into the OGS page, positioned
 * immediately above the OGS AI review panel in the right column.
 *
 * This function is async because it waits for the anchor element to
 * appear in the DOM before inserting the button (OGS renders lazily).
 *
 * @param authState  Determines which button variant to render.
 * @param onClick    Called when the user clicks the button. Receives no
 *                   arguments — the caller wires up the game ID closure.
 */
export async function injectEntryButton(
    authState: AuthState,
    onClick: () => void
): Promise<void> {
    // Always remove any stale button first to avoid duplicates on re-injection
    removeEntryButton();

    const anchor = await waitForAnchor();
    if (!anchor) {
        console.warn(
            "[Kifu-Sensei] Could not find an OGS anchor element within the timeout window. " +
                "The OGS DOM structure may have changed — update OGS_ANCHOR_SELECTORS in overlay.ts."
        );
        return;
    }

    const btn = buildButton(authState);
    btn.addEventListener("click", onClick);

    // Insert before the anchor so the button sits above the OGS AI review panel
    anchor.parentElement?.insertBefore(btn, anchor);
}

/**
 * Updates the button's label and icon to reflect a new auth state, without
 * tearing down and re-injecting the full button.
 *
 * Called when the background service worker detects that the user has just
 * authenticated (e.g. completed registration in the extension-ready tab)
 * and broadcasts an AUTH_STATE_CHANGED message.
 */
export function updateButtonAuthState(authState: AuthState): void {
    const btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
    if (!btn) return;

    const isReady = authState === AuthStates.READY;

    btn.setAttribute("data-ks-auth-state", authState);
    btn.innerHTML = isReady
        ? `<span data-ks-icon style="color:#2A6B4F">✔</span> Kifu-Sensei`
        : `<span data-ks-icon style="color:#2A6B4F;font-size:10px">●</span> Get AI Commentary`;

    // Re-attach hover listeners since innerHTML replacement loses them
    btn.addEventListener("mouseenter", () => {
        btn.style.background = "#EAF4EF";
        btn.style.borderColor = "#2A6B4F";
    });
    btn.addEventListener("mouseleave", () => {
        btn.style.background = "#FFFFFF";
        btn.style.borderColor = "#E8E8E8";
    });
}

/**
 * Removes the injected button from the DOM entirely.
 *
 * Called when the injection guard fails (live game, API error, wrong URL)
 * or when the user navigates away from a game page to a non-game OGS route.
 */
export function removeEntryButton(): void {
    document.getElementById(BUTTON_ID)?.remove();
}
