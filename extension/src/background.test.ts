/**
 * The service worker's session cache.
 *
 * `shared/api.ts` keeps the token pair in module scope and only consults storage
 * when that cache is empty — right for a worker Chrome tears down constantly, and
 * the reason nothing could ever clear it. The worker was the one context not
 * listening for storage changes, so a sign-out from the panel or the content
 * script left it holding a live session, and its next refresh wrote the rotated
 * pair straight back — reviving what the user had just ended.
 */
import { describe, expect, it, vi } from "vitest";

import { AUTH_STORAGE_KEY } from "./shared/constants";
import { fakeChrome } from "./test/setup";

const AUTH = { accessToken: "access-1", refreshToken: "refresh-1" };

type StorageListener = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string
) => void;

/**
 * Import the worker and hand back its storage listener, plus the `shared/api`
 * instance from the same module graph.
 *
 * Fresh each time: importing runs every top-level `addListener`, and a module
 * cached from a previous test would register against that test's fake `chrome`.
 * The api module has to come from the same `resetModules` generation as the
 * worker, or the session cache under test is a different one from the cache the
 * listener mutates.
 */
async function loadWorker(): Promise<{
    onChanged: StorageListener;
    getCurrentAuth: () => unknown;
    setCurrentAuth: (auth: typeof AUTH | null) => void;
}> {
    vi.resetModules();
    await import("./background");
    const api = await import("./shared/api");
    const calls = fakeChrome().storage.onChanged.addListener.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return {
        onChanged: calls[calls.length - 1][0] as StorageListener,
        getCurrentAuth: api.getCurrentAuth,
        setCurrentAuth: api.setCurrentAuth,
    };
}

describe("the worker's cached session", () => {
    it("drops the cache when the session is cleared", async () => {
        const { onChanged, getCurrentAuth, setCurrentAuth } =
            await loadWorker();
        setCurrentAuth(AUTH);

        onChanged({ [AUTH_STORAGE_KEY]: { oldValue: AUTH } }, "local");

        expect(getCurrentAuth()).toBeNull();
    });

    it("adopts a session signed in from another context", async () => {
        const { onChanged, getCurrentAuth } = await loadWorker();

        onChanged({ [AUTH_STORAGE_KEY]: { newValue: AUTH } }, "local");

        expect(getCurrentAuth()).toEqual(AUTH);
    });

    it("treats a malformed stored value as no session", async () => {
        const { onChanged, getCurrentAuth, setCurrentAuth } =
            await loadWorker();
        setCurrentAuth(AUTH);

        onChanged(
            { [AUTH_STORAGE_KEY]: { newValue: { accessToken: "only-one" } } },
            "local"
        );

        expect(getCurrentAuth()).toBeNull();
    });

    it("ignores changes to other keys", async () => {
        const { onChanged, getCurrentAuth, setCurrentAuth } =
            await loadWorker();
        setCurrentAuth(AUTH);

        onChanged({ commentary_config: { newValue: {} } }, "local");

        expect(getCurrentAuth()).toEqual(AUTH);
    });

    it("ignores the session area, which holds the job rather than the session", async () => {
        const { onChanged, getCurrentAuth, setCurrentAuth } =
            await loadWorker();
        setCurrentAuth(AUTH);

        onChanged({ [AUTH_STORAGE_KEY]: { newValue: undefined } }, "session");

        expect(getCurrentAuth()).toEqual(AUTH);
    });
});
