import { defineConfig } from "vitest/config";

// jsdom rather than node: `download.ts` builds a Blob and clicks an anchor, and
// the config helpers are exercised by both a React app and an extension page.
export default defineConfig({
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts"],
        restoreMocks: true,
        clearMocks: true,
        unstubEnvs: true,
        unstubGlobals: true,
    },
});
