import react from "@vitejs/plugin-react";

import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            // Code the web app and the extension must agree on. Compiled from
            // source by each consumer's own build — there is no package to
            // install and no build step of its own.
            "@shared": path.resolve(__dirname, "../shared/src"),
        },
    },
    server: {
        port: 5173,
    },
    build: {
        sourcemap: true,
    },
});
