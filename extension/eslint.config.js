import js from "@eslint/js";

import globals from "globals";
import tseslint from "typescript-eslint";

// Mirrors frontend/eslint.config.js, minus the React plugins. The extension is
// plain DOM, and its three JS worlds each see a different set of globals.
export default tseslint.config(
    { ignores: ["dist", "node_modules"] },
    {
        files: ["**/*.{ts,tsx}"],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            globals: {
                ...globals.browser,
                // `chrome` is injected by the extension runtime, not declared
                // anywhere; `chrome-types` supplies the types but not this.
                chrome: "readonly",
            },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_" },
            ],
        },
    },
    {
        // Config files run in Node, not in a browser or an extension context.
        files: ["*.config.{ts,js}", "vite.*.config.ts"],
        languageOptions: { globals: globals.node },
    },
    {
        // `scripts/*.mjs` matched neither block, so the one script that decides
        // which host permissions ship was linted with no rules and no Node globals.
        files: ["scripts/**/*.mjs"],
        extends: [js.configs.recommended],
        languageOptions: {
            globals: globals.node,
            sourceType: "module",
        },
    }
);
