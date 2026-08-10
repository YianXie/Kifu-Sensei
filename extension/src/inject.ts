import {
    AUTH_MESSAGE_SOURCE,
    AUTH_MESSAGE_TYPE,
    AUTH_STORAGE_KEY,
} from "./shared/constants";
import type { ExtensionAuthObject } from "./shared/types";

let lastData: string | null = null;

function notifyAuthUpdate(parsedData: ExtensionAuthObject | null): void {
    window.postMessage(
        {
            source: AUTH_MESSAGE_SOURCE,
            type: AUTH_MESSAGE_TYPE,
            detail: parsedData,
        },
        window.location.origin
    );
}

function checkStorage(): void {
    let rawData: string | null;
    try {
        rawData = localStorage.getItem(AUTH_STORAGE_KEY);
    } catch (error) {
        // Storage can be unavailable outright (Safari private mode and friends).
        console.error(
            "[Kifu-Sensei inject] Error reading localStorage:",
            error
        );
        return;
    }

    if (rawData === lastData) {
        return;
    }

    let parsedData: ExtensionAuthObject | null;
    try {
        parsedData = rawData ? JSON.parse(rawData) : null;
    } catch (error) {
        // `lastData` is deliberately NOT updated here. It used to be assigned
        // before the parse, so a malformed entry was recorded as already seen and
        // the poll never looked at it again — the handoff stayed broken for the
        // life of the tab, with only a page-console message nobody reads to say so.
        // Leaving it unset means a rewrite of the same key is retried.
        console.error(
            "[Kifu-Sensei inject] Ignoring malformed extension_auth:",
            error
        );
        return;
    }

    lastData = rawData;
    notifyAuthUpdate(parsedData);
}

checkStorage();
setInterval(checkStorage, 500);
