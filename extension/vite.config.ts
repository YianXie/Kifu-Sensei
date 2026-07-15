import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
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
