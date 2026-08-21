/**
 * Guards the one hand-copy this repo still has.
 *
 * `frontend/src/utils/commentary.test.ts` used to compare the two copies of
 * `severityForDelta` as source text, on the reasoning that "a doc comment asking two
 * files to change together is not a guarantee". It was right, and the copies had
 * indeed drifted elsewhere. That particular guard is now unnecessary — there is one
 * `severityForDelta` — but the reasoning still applies to the boundary that cannot
 * be collapsed: this module and `backend/app/schemas.py` are different languages, so
 * the error codes are necessarily written twice.
 *
 * Compared as source text rather than by importing anything: there is no Python to
 * import from here, and a generated client would be a much larger change than the
 * problem warrants.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMENTARY_ERROR_CODES } from "./types";

/**
 * The `code` literal members from `CommentaryErrorResponse`.
 *
 * Resolved from the process working directory — `shared/`, where Vitest is invoked —
 * rather than from `import.meta.url`, which under the jsdom environment is an
 * `http://` URL that `fileURLToPath` cannot take.
 */
function backendErrorCodes(): string[] {
    const source = readFileSync(
        resolve(process.cwd(), "../backend/app/schemas.py"),
        "utf8"
    );

    const marker = "class CommentaryErrorResponse";
    const start = source.indexOf(marker);
    expect(start, "CommentaryErrorResponse not found").toBeGreaterThan(-1);

    const literalStart = source.indexOf("code: Literal[", start);
    expect(literalStart, "the code Literal not found").toBeGreaterThan(-1);
    const open = source.indexOf("[", literalStart);
    const close = source.indexOf("]", open);
    expect(close, "unterminated Literal").toBeGreaterThan(open);

    return [...source.slice(open, close).matchAll(/"([a-z_]+)"/g)].map(
        (match) => match[1]
    );
}

describe("commentary error codes", () => {
    // Both clients used to list seven of the backend's nine. The two they omitted
    // were the ones only the job path raises — so a 409 arrived, failed the code
    // check, was recorded as `code: null`, and the panel offered a "Try Again"
    // button that could only earn the same 409.
    it("match the backend's Literal exactly", () => {
        expect([...COMMENTARY_ERROR_CODES].sort()).toEqual(
            backendErrorCodes().sort()
        );
    });

    it("reads a plausible set, so a parsing failure cannot pass silently", () => {
        const codes = backendErrorCodes();

        expect(codes.length).toBeGreaterThan(5);
        expect(codes).toContain("internal_error");
    });
});
