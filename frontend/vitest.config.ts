import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// Kept separate from `vite.config.ts` so the production build config carries no
// test-only settings; the `@` alias and the React plugin are inherited from it.
export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            environment: "jsdom",
            setupFiles: ["./src/test/setup.ts"],
            include: ["src/**/*.test.{ts,tsx}"],
            // Undo spies, mock state and stubs between tests, so a file cannot
            // depend on what an earlier one left behind.
            restoreMocks: true,
            clearMocks: true,
            unstubEnvs: true,
            unstubGlobals: true,
        },
    })
);
