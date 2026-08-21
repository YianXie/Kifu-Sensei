import { afterEach, beforeEach, vi } from "vitest";

import { installWebStorage } from "./webStorage";

// Must run before anything touches `localStorage` — see the note in webStorage.ts.
// `src/shared/auth.ts` reads it, and `inject.ts` is built around polling it.
installWebStorage();

/**
 * A minimal in-memory stand-in for the `chrome.storage` areas the extension uses.
 *
 * Only the promise-returning shape is modelled, which is what Manifest V3 code
 * calls. Every method is a spy, so a test can assert on writes as well as read
 * back what was written.
 */
function makeStorageArea() {
    let store: Record<string, unknown> = {};
    return {
        get: vi.fn(
            async (keys?: string | string[] | Record<string, unknown>) => {
                if (keys === undefined || keys === null) {
                    return { ...store };
                }
                const names =
                    typeof keys === "string"
                        ? [keys]
                        : Array.isArray(keys)
                          ? keys
                          : Object.keys(keys);
                const result: Record<string, unknown> = {};
                for (const name of names) {
                    if (name in store) {
                        result[name] = store[name];
                    }
                }
                return result;
            }
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
            store = { ...store, ...items };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
            for (const name of Array.isArray(keys) ? keys : [keys]) {
                delete store[name];
            }
        }),
        clear: vi.fn(async () => {
            store = {};
        }),
        /** Test-only escape hatch for seeding or inspecting the area directly. */
        _dump: () => ({ ...store }),
        _reset: () => {
            store = {};
        },
    };
}

export type FakeStorageArea = ReturnType<typeof makeStorageArea>;

export interface FakeChrome {
    storage: {
        local: FakeStorageArea;
        session: FakeStorageArea;
        onChanged: { addListener: ReturnType<typeof vi.fn> };
    };
    runtime: {
        id: string;
        lastError: undefined;
        sendMessage: ReturnType<typeof vi.fn>;
        onMessage: { addListener: ReturnType<typeof vi.fn> };
        onStartup: { addListener: ReturnType<typeof vi.fn> };
    };
    tabs: {
        query: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        sendMessage: ReturnType<typeof vi.fn>;
    };
    // The service worker's own surface, so `background.ts` can be imported.
    sidePanel: {
        setPanelBehavior: ReturnType<typeof vi.fn>;
        open: ReturnType<typeof vi.fn>;
    };
    alarms: {
        get: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        clear: ReturnType<typeof vi.fn>;
        onAlarm: { addListener: ReturnType<typeof vi.fn> };
    };
}

function makeChrome(): FakeChrome {
    return {
        storage: {
            local: makeStorageArea(),
            session: makeStorageArea(),
            onChanged: { addListener: vi.fn() },
        },
        runtime: {
            id: "test-extension-id",
            lastError: undefined,
            sendMessage: vi.fn(async () => undefined),
            onMessage: { addListener: vi.fn() },
            onStartup: { addListener: vi.fn() },
        },
        tabs: {
            query: vi.fn(async () => []),
            create: vi.fn(async () => ({})),
            sendMessage: vi.fn(async () => undefined),
        },
        sidePanel: {
            setPanelBehavior: vi.fn(async () => undefined),
            open: vi.fn(async () => undefined),
        },
        alarms: {
            get: vi.fn(async () => undefined),
            create: vi.fn(async () => undefined),
            clear: vi.fn(async () => true),
            onAlarm: { addListener: vi.fn() },
        },
    };
}

/**
 * Read the fake back with its spies visible.
 *
 * `chrome-types` already declares the global as the real API, so the assignment
 * below and every assertion on it has to go through a cast.
 */
export function fakeChrome(): FakeChrome {
    return globalThis.chrome as unknown as FakeChrome;
}

beforeEach(() => {
    (globalThis as { chrome?: unknown }).chrome = makeChrome();
});

afterEach(() => {
    localStorage.clear();
});
