import {
    type ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
    type ResolvedTheme,
    type ThemePreference,
    isThemePreference,
} from "@/types/theme";

/** Where the preference is remembered between visits. */
const STORAGE_KEY = "ks_theme";

function readStoredPreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return isThemePreference(stored) ? stored : "system";
    } catch {
        // Private-mode Safari and friends. A missing preference is not fatal.
        return "system";
    }
}

interface ThemeContextValue {
    /** What the user asked for, including "follow the OS". */
    preference: ThemePreference;
    /** What that resolves to right now — what the UI is actually painted in. */
    resolved: ResolvedTheme;
    setPreference: (preference: ThemePreference) => void;
    /** Flip between light and dark, leaving "system" behind. */
    toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the light/dark preference and writes it to `<html data-theme>`, which is
 * what the design system's colour tokens key off.
 *
 * Two things can set it, and they do not fight:
 *
 * - The navbar toggle and the Settings segmented control both call
 *   `setPreference`, which takes effect immediately and is remembered in
 *   `localStorage` so a reload doesn't flash the old theme.
 * - The signed-in account preference (`serverPreference`) wins whenever it
 *   *changes* — on hydration, on login, and when Settings saves it. A local
 *   toggle doesn't change the server value, so it is never clobbered by this.
 */
export function ThemeProvider({
    children,
    serverPreference,
}: {
    children: ReactNode;
    /** `preferences.theme` from the signed-in user's settings, if loaded. */
    serverPreference?: unknown;
}) {
    const [preference, setPreferenceState] =
        useState<ThemePreference>(readStoredPreference);
    const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
    const resolved: ResolvedTheme =
        preference === "system" ? (prefersDark ? "dark" : "light") : preference;

    const setPreference = useCallback((next: ThemePreference) => {
        setPreferenceState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Non-fatal: the theme still applies for this session.
        }
    }, []);

    const toggle = useCallback(() => {
        setPreference(resolved === "dark" ? "light" : "dark");
    }, [resolved, setPreference]);

    // Adopt the account preference whenever the server's value changes.
    const lastServerPreference = useRef<ThemePreference | null>(null);
    useEffect(() => {
        if (!isThemePreference(serverPreference)) return;
        if (serverPreference === lastServerPreference.current) return;
        lastServerPreference.current = serverPreference;
        setPreference(serverPreference);
    }, [serverPreference, setPreference]);

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", resolved);
    }, [resolved]);

    return (
        <ThemeContext.Provider
            value={{ preference, resolved, setPreference, toggle }}
        >
            {children}
        </ThemeContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
    return ctx;
}
