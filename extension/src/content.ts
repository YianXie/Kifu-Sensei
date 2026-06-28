import type { ExtensionAuthObject } from "./shared/types";

const MESSAGE_SOURCE = "kifu-sensei-inject";
const MESSAGE_TYPE = "extension_auth_update";

function isAuthUpdateMessage(data: unknown): data is {
    source: typeof MESSAGE_SOURCE;
    type: typeof MESSAGE_TYPE;
    detail: ExtensionAuthObject | null;
} {
    if (typeof data !== "object" || data === null) {
        return false;
    }

    const message = data as Record<string, unknown>;
    return (
        message.source === MESSAGE_SOURCE &&
        message.type === MESSAGE_TYPE &&
        (message.detail === null || typeof message.detail === "object")
    );
}

function injectPageScript(): void {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("dist/inject.js");
    script.onload = function () {
        (this as HTMLScriptElement).remove();
    };
    (document.head || document.documentElement).appendChild(script);
}

function handleAuthUpdate(updatedObject: ExtensionAuthObject | null): void {
    console.log(
        "[Kifu-Sensei content] Detected extension_auth update:",
        updatedObject
    );
}

window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) {
        return;
    }

    if (!isAuthUpdateMessage(event.data)) {
        return;
    }

    handleAuthUpdate(event.data.detail);
});

injectPageScript();
