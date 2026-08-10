import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { severityForDelta } from "@/utils/commentary";

describe("severityForDelta", () => {
    it("tiers a win-rate swing", () => {
        expect(severityForDelta(-25)).toBe("blunder");
        expect(severityForDelta(-10)).toBe("blunder");
        expect(severityForDelta(-9.9)).toBe("mistake");
        expect(severityForDelta(-5)).toBe("mistake");
        expect(severityForDelta(-4.9)).toBe("notable");
        expect(severityForDelta(0)).toBe("notable");
        expect(severityForDelta(12)).toBe("notable");
    });

    it("treats a missing delta as notable", () => {
        expect(severityForDelta(null)).toBe("notable");
        expect(severityForDelta(undefined)).toBe("notable");
    });
});

/**
 * The extension ships its own copy of `severityForDelta` (separate build, no shared
 * module — see the note in `utils/commentary.ts`). A doc comment asking two files to
 * change together is not a guarantee, so this compares the two implementations
 * directly and fails CI on drift, rather than letting the web app and the extension
 * quietly disagree about what counts as a blunder.
 *
 * Compared as *source text* rather than by importing the extension module: importing
 * across the project boundary would drag the extension's own imports and tsconfig
 * `rootDir` into this build for no benefit.
 */
function extractSeverityBody(source: string): string {
    const start = source.indexOf("export function severityForDelta");
    expect(start, "severityForDelta not found").toBeGreaterThan(-1);
    const open = source.indexOf("{", source.indexOf(")", start));
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) {
                // Whitespace is normalised so the two copies may be formatted to
                // their own project's Prettier config without failing this.
                return source.slice(open, i + 1).replace(/\s+/g, " ");
            }
        }
    }
    throw new Error("Unbalanced braces in severityForDelta");
}

describe("severity thresholds", () => {
    it("match the extension's copy", () => {
        // Resolved from the process working directory (the `frontend/` project root,
        // where Vitest is invoked) rather than from `import.meta.url`: under the jsdom
        // environment that is an `http://` URL, not a `file://` one, so the usual
        // `fileURLToPath` trick does not work here.
        const root = process.cwd();
        const frontend = readFileSync(
            resolve(root, "src/utils/commentary.ts"),
            "utf8"
        );
        const extension = readFileSync(
            resolve(root, "../extension/src/shared/commentary.ts"),
            "utf8"
        );

        expect(extractSeverityBody(extension)).toBe(
            extractSeverityBody(frontend)
        );
    });
});
