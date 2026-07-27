import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// inject.ts is appended to the page as a plain <script src=...> by content.ts, so the
// browser loads it as a *classic* script — an `import` statement in it fails at
// runtime with "Cannot use import statement outside a module", taking the whole auth
// handoff with it.
//
// It used to be emitted by the main ES build and only worked because it happened to
// import nothing. The moment it shared a module with another entry (the storage-key
// constants), Rollup hoisted that into a chunk and the emitted file gained an import.
// Building it as its own self-contained IIFE makes the output format match the way it
// is actually loaded, so shared imports are safe. Runs after the main build, hence
// emptyOutDir: false.
export default defineConfig({
    base: "",

    build: {
        outDir: "dist",
        emptyOutDir: false,
        modulePreload: { polyfill: false },

        rollupOptions: {
            input: {
                inject: resolve(__dirname, "src/inject.ts"),
            },

            output: {
                entryFileNames: "[name].js",
                format: "iife",
            },
        },
    },
});
