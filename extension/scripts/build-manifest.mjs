// Generates extension/manifest.json from manifest.template.json.
//
// The template holds only the real origins (online-go.com, kifu-sensei.ai) —
// what a distributed build should ship. A development build additionally
// needs the localhost origins so the extension can talk to the local dev
// servers; those are read straight out of .env.development (VITE_API_URL,
// VITE_FRONTEND_URL) rather than duplicated here, so the two can't drift.
//
// Usage: node scripts/build-manifest.mjs <production|development>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] ?? "production";

if (mode !== "production" && mode !== "development") {
    console.error(
        `Unknown mode "${mode}" — expected "production" or "development".`
    );
    process.exit(1);
}

const manifest = JSON.parse(
    readFileSync(resolve(root, "manifest.template.json"), "utf-8")
);

if (mode === "development") {
    const env = parseEnvFile(resolve(root, ".env.development"));
    const apiOrigin = originOf(env.VITE_API_URL);
    const frontendOrigin = originOf(env.VITE_FRONTEND_URL);

    // The backend is only ever fetch()ed (background/panel), never navigated
    // to, so it only needs host_permissions — not a content-script match.
    manifest.host_permissions.push(apiOrigin, frontendOrigin);
    manifest.content_scripts[0].matches.push(frontendOrigin);
    manifest.web_accessible_resources[0].matches.push(frontendOrigin);
}

writeFileSync(
    resolve(root, "manifest.json"),
    JSON.stringify(manifest, null, 4) + "\n"
);
console.log(`Generated manifest.json (mode: ${mode})`);

function parseEnvFile(path) {
    const env = {};
    for (const line of readFileSync(path, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const equals = trimmed.indexOf("=");
        if (equals === -1) continue;
        env[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
    }
    return env;
}

function originOf(url) {
    return `${new URL(url).origin}/*`;
}
