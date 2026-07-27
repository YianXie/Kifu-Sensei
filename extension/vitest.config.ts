import { defineConfig } from "vitest/config";

// Standalone rather than merged with vite.config.ts: that config is one of four
// build entry points and carries `build.rollupOptions` that mean nothing here.
export default defineConfig({
    test: {
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        include: ["src/**/*.test.ts", "panel/**/*.test.ts"],
        restoreMocks: true,
        clearMocks: true,
        unstubEnvs: true,
        unstubGlobals: true,
    },
});
