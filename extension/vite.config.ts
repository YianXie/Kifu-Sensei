import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { readFileSync } from "fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Vite plugin that copies overlay.css directly into dist/styles/.
 *
 * We can't rely on importing the CSS from the content script entry point
 * because Vite 8 (Rolldown) drops CSS imported from non-HTML entries rather
 * than extracting it to a file. Using emitFile() with type: 'asset' bypasses
 * that pipeline and writes the file at the exact path the manifest expects.
 */
function emitContentCss() {
    return {
        name: "emit-content-css",
        generateBundle() {
            this.emitFile({
                type: "asset",
                fileName: "styles/overlay.css",
                source: readFileSync(
                    resolve(__dirname, "src/styles/overlay.css"),
                    "utf-8"
                ),
            });
        },
    };
}

export default defineConfig({
    plugins: [emitContentCss()],
    base: "",

    build: {
        outDir: "dist",
        emptyOutDir: true,
        modulePreload: { polyfill: false },

        rollupOptions: {
            input: {
                panel: resolve(__dirname, "panel/panel.html"),
                inject: resolve(__dirname, "src/inject.ts"),
                content: resolve(__dirname, "src/content.ts"),
                background: resolve(__dirname, "src/background.ts"),
            },

            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith(".css")) {
                        return "styles/[name][extname]";
                    }
                    return "assets/[name][extname]";
                },
                format: "es",
            },
        },
    },
});
