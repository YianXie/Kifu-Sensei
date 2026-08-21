// Light/dark for the side panel.
//
// The panel had no theme at all: `panel.css` contained not one `@media` rule, so
// `prefers-color-scheme` was not even possible, and the page was hard-wired to a
// white background. Meanwhile the website has been dark by default since the design
// system landed, with a three-way preference saved on the account — which the panel
// was already fetching and reading only `commentary_config` out of.
//
// Mirrors `frontend/src/contexts/ThemeContext.tsx`: same three preferences, same
// resolution, same `<html data-theme>` output. The storage differs because a panel
// cannot see the website's localStorage.

/** What the user asked for, including "follow the OS". */
export type ThemePreference = "system" | "light" | "dark";

/** What that resolves to — what the panel is actually painted in. */
export type ResolvedTheme = "light" | "dark";

/**
 * Where the preference is cached.
 *
 * The account is the source of truth, but reading it costs a network round trip,
 * and a panel that painted light for 200ms before flipping to dark would be worse
 * than one that never flipped. So the last known value is kept locally and applied
 * synchronously on open; `adoptAccountTheme` corrects it when settings arrive.
 */
const THEME_STORAGE_KEY = "ks_theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === "system" || value === "light" || value === "dark";
}

function resolve(preference: ThemePreference): ResolvedTheme {
    if (preference === "system") {
        return globalThis.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
    }
    return preference;
}

function apply(preference: ThemePreference): void {
    document.documentElement.dataset.theme = resolve(preference);
}

let current: ThemePreference = "system";

/**
 * Paint the panel before anything else runs.
 *
 * Deliberately not `async`: the attribute is written from the in-memory default
 * first so the very first frame is already themed, and the cached preference is
 * applied as soon as `chrome.storage` answers — which is fast, and cannot flash
 * more than one repaint.
 */
export function initTheme(): void {
    apply(current);

    globalThis
        .matchMedia?.(DARK_QUERY)
        .addEventListener("change", () => apply(current));

    // Guarded because this runs first in `init()`: a theme that cannot be read is
    // a cosmetic problem, but an exception here would take down every screen
    // wired up after it.
    try {
        void chrome.storage.local
            .get(THEME_STORAGE_KEY)
            .then((stored) => {
                const cached = stored[THEME_STORAGE_KEY];
                if (isThemePreference(cached)) {
                    current = cached;
                    apply(current);
                }
            })
            .catch(() => {});
    } catch {
        // No storage available. The OS preference is still applied.
    }
}

/**
 * Adopt `preferences.theme` from the account and cache it for the next open.
 *
 * Called from `syncAuthState`, which already has the settings response in hand.
 * A signed-out panel keeps following the OS.
 */
export async function adoptAccountTheme(preference: unknown): Promise<void> {
    if (!isThemePreference(preference) || preference === current) {
        return;
    }
    current = preference;
    apply(current);
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference });
}
