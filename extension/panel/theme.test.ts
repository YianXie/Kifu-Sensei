import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeChrome } from "../src/test/setup";

/**
 * `theme.ts` keeps the resolved preference in module scope, which is right for a
 * panel that loads once — and means each test needs its own instance rather than
 * inheriting whatever the last one left behind.
 */
async function loadTheme() {
    vi.resetModules();
    return import("./theme");
}

/** Stub `matchMedia`, which jsdom does not implement. */
function stubPrefersDark(matches: boolean): void {
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
            matches,
            media: "(prefers-color-scheme: dark)",
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }))
    );
}

function resolvedTheme(): string | undefined {
    return document.documentElement.dataset.theme;
}

beforeEach(() => {
    delete document.documentElement.dataset.theme;
});

describe("isThemePreference", () => {
    it("accepts the three the website can save", async () => {
        const { isThemePreference } = await loadTheme();
        expect(isThemePreference("system")).toBe(true);
        expect(isThemePreference("light")).toBe(true);
        expect(isThemePreference("dark")).toBe(true);
    });

    it("rejects anything else", async () => {
        const { isThemePreference } = await loadTheme();
        expect(isThemePreference("sepia")).toBe(false);
        expect(isThemePreference(undefined)).toBe(false);
        expect(isThemePreference(null)).toBe(false);
    });
});

describe("initTheme", () => {
    it("paints before the first screen, without waiting for storage", async () => {
        const { initTheme } = await loadTheme();
        stubPrefersDark(true);

        initTheme();

        // Synchronous: no await, no flash of the wrong theme.
        expect(resolvedTheme()).toBe("dark");
    });

    it("follows the OS when no preference has been cached", async () => {
        const { initTheme } = await loadTheme();
        stubPrefersDark(false);

        initTheme();

        expect(resolvedTheme()).toBe("light");
    });

    it("applies the cached preference once storage answers", async () => {
        const { initTheme } = await loadTheme();
        stubPrefersDark(true);
        await fakeChrome().storage.local.set({ ks_theme: "light" });

        initTheme();
        await vi.waitFor(() => expect(resolvedTheme()).toBe("light"));
    });

    it("ignores a cached value that is not a preference", async () => {
        const { initTheme } = await loadTheme();
        stubPrefersDark(true);
        await fakeChrome().storage.local.set({ ks_theme: "sepia" });

        initTheme();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(resolvedTheme()).toBe("dark");
    });
});

describe("adoptAccountTheme", () => {
    it("takes the account's preference and remembers it for next open", async () => {
        const { adoptAccountTheme, initTheme } = await loadTheme();
        stubPrefersDark(true);
        initTheme();

        await adoptAccountTheme("light");

        expect(resolvedTheme()).toBe("light");
        const stored = await fakeChrome().storage.local.get("ks_theme");
        expect(stored.ks_theme).toBe("light");
    });

    it("resolves 'system' against the OS rather than storing a colour", async () => {
        const { adoptAccountTheme, initTheme } = await loadTheme();
        stubPrefersDark(true);
        initTheme();
        await adoptAccountTheme("light");

        await adoptAccountTheme("system");

        expect(resolvedTheme()).toBe("dark");
    });

    it("leaves a signed-out panel following the OS", async () => {
        const { adoptAccountTheme, initTheme } = await loadTheme();
        stubPrefersDark(false);
        initTheme();

        await adoptAccountTheme(undefined);

        expect(resolvedTheme()).toBe("light");
        const stored = await fakeChrome().storage.local.get("ks_theme");
        expect(stored.ks_theme).toBeUndefined();
    });
});
