/**
 * Give the test environment a working `localStorage` / `sessionStorage`.
 *
 * Node 22 added its own Web Storage globals, inert unless the process was started
 * with `--localstorage-file`. Vitest's jsdom environment only copies a window
 * property onto `globalThis` when that name is still free, so Node's inert pair
 * wins the name and jsdom's real Storage never lands: every `localStorage.getItem`
 * then throws "Cannot read properties of undefined". Defining our own takes the
 * name back, and does it the same way in both projects.
 *
 * The web app keeps an identical copy at `frontend/src/test/webStorage.ts` —
 * separate build, no shared module — so change both together.
 */

function createStorage(): Storage {
    const entries = new Map<string, string>();
    return {
        get length(): number {
            return entries.size;
        },
        key: (index: number): string | null =>
            [...entries.keys()][index] ?? null,
        getItem: (key: string): string | null =>
            entries.get(String(key)) ?? null,
        setItem: (key: string, value: string): void => {
            entries.set(String(key), String(value));
        },
        removeItem: (key: string): void => {
            entries.delete(String(key));
        },
        clear: (): void => {
            entries.clear();
        },
    } as Storage;
}

/** Idempotent: a second call replaces the areas with empty ones. */
export function installWebStorage(): void {
    for (const name of ["localStorage", "sessionStorage"] as const) {
        const storage = createStorage();
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value: storage,
        });
        // In vitest's jsdom environment `window` *is* `globalThis`, but don't rely
        // on that — a future environment where they differ would silently leave
        // `window.localStorage` broken.
        if (typeof window !== "undefined" && window !== globalThis) {
            Object.defineProperty(window, name, {
                configurable: true,
                writable: true,
                value: storage,
            });
        }
    }
}
