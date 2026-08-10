import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";

import { afterEach, vi } from "vitest";

import { installWebStorage } from "./webStorage";

// Must run before anything touches `localStorage` — see the note in webStorage.ts.
installWebStorage();

// jsdom implements neither of these, and MUI's responsive styling reads
// `matchMedia` during render.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

// `HTMLMediaElement.play` is unimplemented in jsdom and throws "Not implemented"
// on the console for every stone placed.
Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
});

// jsdom has no ResizeObserver; GameViewer uses one to size the board column.
if (!window.ResizeObserver) {
    class MockResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }
    window.ResizeObserver =
        MockResizeObserver as unknown as typeof ResizeObserver;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});
