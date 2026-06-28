import type { ExtensionAuthObject } from "./types";

const EXTENSION_AUTH_KEY = "extension_auth";

export function getExtensionAuth(): ExtensionAuthObject | null {
    const rawData = localStorage.getItem(EXTENSION_AUTH_KEY);
    return rawData ? JSON.parse(rawData) : null;
}

export function isAuthenticated(): boolean {
    return getExtensionAuth() !== null;
}
