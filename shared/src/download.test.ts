import { describe, expect, it } from "vitest";

import { SGF_MIME_TYPE, annotatedFileName } from "./download";

describe("annotatedFileName", () => {
    // The web review screen used to hand the browser the *uploaded* file's name.
    it("never returns the name it was given", () => {
        expect(annotatedFileName("mygame.sgf")).not.toBe("mygame.sgf");
    });

    it("suffixes the base name once", () => {
        expect(annotatedFileName("mygame.sgf")).toBe("mygame_annotated.sgf");
        expect(annotatedFileName("mygame")).toBe("mygame_annotated.sgf");
        expect(annotatedFileName("ogs-65097807.SGF")).toBe(
            "ogs-65097807_annotated.sgf"
        );
    });

    it("still produces a usable name when there is nothing to work from", () => {
        expect(annotatedFileName("")).toBe("commentary_annotated.sgf");
    });
});

describe("SGF_MIME_TYPE", () => {
    it("is the SGF type, not text/plain", () => {
        expect(SGF_MIME_TYPE).toBe("application/x-go-sgf");
    });
});
