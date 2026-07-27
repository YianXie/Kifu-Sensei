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
    try {
        const rawData = localStorage.getItem(AUTH_STORAGE_KEY);

        if (rawData !== lastData) {
            lastData = rawData;
            const parsedData: ExtensionAuthObject | null = rawData
                ? JSON.parse(rawData)
                : null;

            notifyAuthUpdate(parsedData);
        }
    } catch (error) {
        console.error(
            "[Kifu-Sensei inject] Error reading localStorage:",
            error
        );
    }
}

checkStorage();
setInterval(checkStorage, 500);
