import type { ExtensionAuthObject } from "./shared/types";

const TARGET_KEY = "extension_auth";
const MESSAGE_SOURCE = "kifu-sensei-inject";
const MESSAGE_TYPE = "extension_auth_update";

let lastData: string | null = null;

function notifyAuthUpdate(parsedData: ExtensionAuthObject | null): void {
    window.postMessage(
        {
            source: MESSAGE_SOURCE,
            type: MESSAGE_TYPE,
            detail: parsedData,
        },
        window.location.origin
    );
}

function checkStorage(): void {
    try {
        const rawData = localStorage.getItem(TARGET_KEY);

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
