import { resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    base: "",

    build: {
        outDir: "dist",
        emptyOutDir: true,
        modulePreload: { polyfill: false },

        rollupOptions: {
            // Only the entries the browser genuinely loads as ES modules belong
            // here: the side panel (<script type="module">) and the service worker
            // ("type": "module" in the manifest). Rollup may hoist code they share
            // into a chunk, which is fine for both.
            //
            // content.ts and inject.ts are built separately as classic IIFEs —
            // see vite.content.config.ts and vite.inject.config.ts.
            input: {
                panel: resolve(__dirname, "panel/panel.html"),
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
