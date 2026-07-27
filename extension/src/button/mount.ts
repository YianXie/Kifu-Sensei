// Keeping the button attached to a React page that rebuilds itself underneath us.
//
// OGS is a single-page app: the game view is re-rendered on navigation, the container
// often does not exist yet at `document_idle`, and moving between games changes the URL
// with no page load at all. So the button is (re)mounted from an observer rather than
// once at startup.

import { checkOgsGame, type OgsGameCheck } from "../shared/ogs";

/**
 * Where the button goes, best first.
 *
 * Verified against a live finished game: `.game-action-buttons` sits at the top of
 * `.PlayControls` and is empty once a game is over, which makes it the natural slot.
 * The rest are fallbacks for layouts (or future OGS versions) where it is absent.
 * These class names are not a public API, hence the chain.
 */
const MOUNT_SELECTORS = [
    ".PlayControls .game-action-buttons",
    ".PlayControls",
    ".Game .right-col",
];

/** Matches the poll in `inject.ts`; fast enough to feel instant, cheap enough to run. */
const URL_POLL_MS = 500;

export function findMountPoint(): Element | null {
    for (const selector of MOUNT_SELECTORS) {
        const node = document.querySelector(selector);
        if (node !== null) {
            return node;
        }
    }
    return null;
}

export interface MountWatcherOptions {
    /** Called whenever the page settles on a different URL. */
    onNavigate: (check: OgsGameCheck) => void | Promise<void>;
    /** Called often; should cheaply re-attach the button if it has been detached. */
    onMaybeRemount: () => void;
}

/**
 * Watch for the two ways the button can be lost: React replacing the subtree it was
 * in, and the SPA navigating to a different game.
 *
 * The URL is polled rather than hooked. `history.pushState` cannot be patched from the
 * isolated world, and the Navigation API's behaviour there could not be confirmed —
 * polling is certain, and at 500 ms it costs nothing.
 */
export function watchForMount(options: MountWatcherOptions): () => void {
    let lastUrl = location.href;

    const handleNavigation = (): void => {
        if (location.href === lastUrl) {
            return;
        }
        lastUrl = location.href;
        void (async () => {
            options.onNavigate(await checkOgsGame(location.href));
        })();
    };

    const observer = new MutationObserver(() => {
        options.onMaybeRemount();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setInterval(() => {
        handleNavigation();
        options.onMaybeRemount();
    }, URL_POLL_MS);

    window.addEventListener("popstate", handleNavigation);

    return () => {
        observer.disconnect();
        clearInterval(timer);
        window.removeEventListener("popstate", handleNavigation);
    };
}
