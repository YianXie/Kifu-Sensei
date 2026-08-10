import js from "@eslint/js";

import globals from "globals";
import tseslint from "typescript-eslint";

// Mirrors extension/eslint.config.js, minus the `chrome` global. These sources
// run in both a React app and an extension page, so they may assume only what
// both provide: the browser globals and nothing else.
export default tseslint.config(
    { ignores: ["node_modules"] },
    {
        files: ["**/*.ts"],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            globals: globals.browser,
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
        files: ["*.config.{ts,js}"],
        languageOptions: { globals: globals.node },
    }
);
