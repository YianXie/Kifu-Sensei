import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Chrome loads content scripts as classic scripts — ES modules are not
// supported there — so this entry is built separately as a self-contained
// IIFE. Bundling it with the module entries in vite.config.ts lets Rollup
// hoist shared code (shared/config.ts) into a chunk, which emits an `import`
// statement that fails at runtime with "Cannot use import statement outside a
// module". Runs after the main build, hence emptyOutDir: false.
export default defineConfig({
    base: "",

    build: {
        outDir: "dist",
        emptyOutDir: false,
        modulePreload: { polyfill: false },

        rollupOptions: {
            input: {
                content: resolve(__dirname, "src/content.ts"),
            },

            output: {
                entryFileNames: "[name].js",
                format: "iife",
            },
        },
    },
});
