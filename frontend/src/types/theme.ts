/** What the user asked for, including "follow the OS". */
export type ThemePreference = "system" | "light" | "dark";

/** What that resolves to — what the UI is actually painted in. */
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === "system" || value === "light" || value === "dark";
}
