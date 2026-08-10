import { resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Standalone rather than merged with vite.config.ts: that config is one of the
// build entry points and carries `build.rollupOptions` that mean nothing here.
// The @shared alias therefore has to be repeated rather than inherited.
export default defineConfig({
    resolve: {
        alias: {
            "@shared": resolve(__dirname, "../shared/src"),
        },
    },
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
