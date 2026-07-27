import { describe, expect, it } from "vitest";

import { toTitleCase } from "@/utils/string";

describe("toTitleCase", () => {
    it("capitalises each word", () => {
        expect(toTitleCase("hello world")).toBe("Hello World");
    });

    it("lowercases the rest of each word", () => {
        expect(toTitleCase("HELLO WORLD")).toBe("Hello World");
    });

    it("renders the language values used on history cards", () => {
        expect(toTitleCase("english")).toBe("English");
        expect(toTitleCase("chinese (simplified)")).toBe(
            "Chinese (simplified)"
        );
        expect(toTitleCase("japanese")).toBe("Japanese");
    });

    it("returns an empty string unchanged", () => {
        expect(toTitleCase("")).toBe("");
    });

    it("leaves single-character words alone", () => {
        expect(toTitleCase("a b")).toBe("A B");
    });
});
