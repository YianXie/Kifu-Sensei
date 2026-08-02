/**
 * content.ts also runs on online-go.com (for the injected review button), so the
 * auth handoff's `window.addEventListener("message", ...)` must reject anything not
 * posted by the frontend itself — otherwise any page this script runs on could plant
 * arbitrary tokens into `chrome.storage.local`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_STORAGE_KEY } from "./shared/constants";
import { fakeChrome } from "./test/setup";

const FRONTEND_ORIGIN = "http://localhost:5173";
const OTHER_ORIGIN = "https://evil.example";

function postAuthMessage(origin: string, detail: unknown): void {
    window.dispatchEvent(
        new MessageEvent("message", {
            data: {
                source: "kifu-sensei-inject",
                type: "extension_auth_update",
                detail,
            },
            origin,
            source: window,
        })
    );
}

async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("content.ts auth handoff", () => {
    beforeEach(async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: true, json: async () => ({}) }))
        );
        await import("./content");
    });

    it("ignores an auth update posted from a non-frontend origin", async () => {
        postAuthMessage(OTHER_ORIGIN, {
            accessToken: "attacker-access",
            refreshToken: "attacker-refresh",
        });
        await flushMicrotasks();

        expect(fakeChrome().storage.local.set).not.toHaveBeenCalled();
    });

    it("accepts an auth update posted from the frontend origin", async () => {
        postAuthMessage(FRONTEND_ORIGIN, {
            accessToken: "real-access",
            refreshToken: "real-refresh",
        });
        await flushMicrotasks();

        expect(fakeChrome().storage.local.set).toHaveBeenCalledWith({
            [AUTH_STORAGE_KEY]: {
                accessToken: "real-access",
                refreshToken: "real-refresh",
            },
        });
    });
});
