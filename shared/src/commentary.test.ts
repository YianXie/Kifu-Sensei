import { describe, expect, it } from "vitest";

import {
    CLAUDE_MODELS,
    CLAUDE_MODEL_LABELS,
    COMMENTARY_LANGUAGES,
    COMMENTARY_LANGUAGE_LABELS,
    CUSTOM_INSTRUCTION_MAX,
    DEFAULT_COMMENTARY_CONFIG,
    MAX_TOKEN_MAX,
    MAX_TOKEN_MIN,
    NUM_COMMENTS_MAX,
    NUM_COMMENTS_MIN,
    clampCommentaryConfig,
    colorForTurn,
    coordinateForTurn,
    formatDelta,
    readCommentaryConfig,
    severityForDelta,
} from "./commentary";
import type { GameMove } from "./types";

describe("model and language lists", () => {
    it("labels every model and language", () => {
        for (const model of CLAUDE_MODELS) {
            expect(CLAUDE_MODEL_LABELS[model]).toBeTruthy();
        }
        for (const language of COMMENTARY_LANGUAGES) {
            expect(COMMENTARY_LANGUAGE_LABELS[language]).toBeTruthy();
        }
    });

    it("defaults to values the lists actually contain", () => {
        expect(CLAUDE_MODELS).toContain(DEFAULT_COMMENTARY_CONFIG.model);
        expect(COMMENTARY_LANGUAGES).toContain(
            DEFAULT_COMMENTARY_CONFIG.language
        );
    });
});

describe("readCommentaryConfig", () => {
    it("falls back to the defaults when there is nothing saved", () => {
        expect(readCommentaryConfig(undefined)).toEqual(
            DEFAULT_COMMENTARY_CONFIG
        );
        expect(readCommentaryConfig(null)).toEqual(DEFAULT_COMMENTARY_CONFIG);
        expect(readCommentaryConfig({})).toEqual(DEFAULT_COMMENTARY_CONFIG);
    });

    it("reads a fully populated saved config", () => {
        expect(
            readCommentaryConfig({
                commentary_config: {
                    model: "claude-opus-5",
                    language: "japanese",
                    num_comments: 30,
                    max_token: 2048,
                    custom_instruction: "Focus on the opening.",
                },
            })
        ).toEqual({
            model: "claude-opus-5",
            language: "japanese",
            num_comments: 30,
            max_token: 2048,
            custom_instruction: "Focus on the opening.",
        });
    });

    it("discards a model or language the backend no longer accepts", () => {
        const config = readCommentaryConfig({
            commentary_config: {
                model: "claude-3-5-sonnet",
                language: "klingon",
            },
        });

        expect(config.model).toBe(DEFAULT_COMMENTARY_CONFIG.model);
        expect(config.language).toBe(DEFAULT_COMMENTARY_CONFIG.language);
    });

    it("clamps saved values that fall outside the backend's bounds", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: 5000, max_token: 99999 },
        });

        expect(config.num_comments).toBe(NUM_COMMENTS_MAX);
        expect(config.max_token).toBe(MAX_TOKEN_MAX);
    });

    // The drift this module was extracted to end: the extension guarded with a bare
    // `Number.isFinite`, so `Number(null) === 0` passed and clamped up to 1 — one
    // comment in the panel where the website generated twenty.
    it.each([
        ["null", null],
        ["an empty string", ""],
        ["an empty array", []],
        ["a non-numeric string", "lots"],
        ["zero", 0],
        ["a negative count", -5],
    ])("falls back to the default for %s, never to the minimum", (_, value) => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: value, max_token: value },
        });

        expect(config.num_comments).toBe(
            DEFAULT_COMMENTARY_CONFIG.num_comments
        );
        expect(config.num_comments).not.toBe(NUM_COMMENTS_MIN);
        expect(config.max_token).toBe(DEFAULT_COMMENTARY_CONFIG.max_token);
        expect(config.max_token).not.toBe(MAX_TOKEN_MIN);
    });

    it("truncates an over-long custom instruction", () => {
        const config = readCommentaryConfig({
            commentary_config: { custom_instruction: "x".repeat(5000) },
        });

        expect(config.custom_instruction).toHaveLength(CUSTOM_INSTRUCTION_MAX);
    });

    it("falls back when the custom instruction is not a string", () => {
        expect(
            readCommentaryConfig({
                commentary_config: { custom_instruction: { a: 1 } },
            }).custom_instruction
        ).toBe("");
    });
});

describe("clampCommentaryConfig", () => {
    it("leaves an in-range config alone", () => {
        expect(clampCommentaryConfig(DEFAULT_COMMENTARY_CONFIG)).toEqual(
            DEFAULT_COMMENTARY_CONFIG
        );
    });

    it("pulls values back inside the bounds", () => {
        const config = clampCommentaryConfig({
            ...DEFAULT_COMMENTARY_CONFIG,
            num_comments: 0,
            max_token: 1,
        });

        expect(config.num_comments).toBe(NUM_COMMENTS_MIN);
        expect(config.max_token).toBe(MAX_TOKEN_MIN);
    });

    it("rounds fractional counts, which the backend types as ints", () => {
        const config = clampCommentaryConfig({
            ...DEFAULT_COMMENTARY_CONFIG,
            num_comments: 12.6,
            max_token: 1024.4,
        });

        expect(config.num_comments).toBe(13);
        expect(config.max_token).toBe(1024);
    });
});

describe("severityForDelta", () => {
    it.each([
        [-50, "blunder"],
        [-10, "blunder"],
        [-9.9, "mistake"],
        [-5, "mistake"],
        [-4.9, "notable"],
        [0, "notable"],
        [12, "notable"],
    ])("maps %s to %s", (delta, expected) => {
        expect(severityForDelta(delta)).toBe(expected);
    });

    it("treats an unknown swing as notable", () => {
        expect(severityForDelta(null)).toBe("notable");
        expect(severityForDelta(undefined)).toBe("notable");
    });
});

describe("colorForTurn", () => {
    const moves: GameMove[] = [
        ["B", [3, 3]],
        ["W", [15, 15]],
        ["B", [2, 15]],
    ];

    it("reads the colour from the move list", () => {
        expect(colorForTurn(moves, 1)).toBe("B");
        expect(colorForTurn(moves, 2)).toBe("W");
    });

    it("is right for a handicap game, where parity is inverted", () => {
        // Handicap stones live in initial_stones, so White opens.
        const handicap: GameMove[] = [
            ["W", [15, 3]],
            ["B", [3, 15]],
        ];

        expect(colorForTurn(handicap, 1)).toBe("W");
        expect(colorForTurn(handicap, 2)).toBe("B");
    });

    it("uses the fallback for a turn the move list does not cover", () => {
        expect(colorForTurn(moves, 99, "W")).toBe("W");
        expect(colorForTurn(moves, 99)).toBe("B");
    });

    it("prefers the move list over the fallback", () => {
        expect(colorForTurn(moves, 2, "B")).toBe("W");
    });
});

describe("coordinateForTurn", () => {
    const moves: GameMove[] = [
        ["B", [3, 3]],
        ["W", [15, 15]],
        ["B", null],
    ];

    it("renders GTP coordinates, skipping the letter I", () => {
        expect(coordinateForTurn(moves, 1)).toBe("D4");
        expect(coordinateForTurn(moves, 2)).toBe("Q16");
    });

    it("is empty for a pass or a turn outside the game", () => {
        expect(coordinateForTurn(moves, 3)).toBe("");
        expect(coordinateForTurn(moves, 99)).toBe("");
    });
});

describe("formatDelta", () => {
    it("signs a loss with a minus sign, not a hyphen", () => {
        expect(formatDelta(-12.4)).toBe("−12%");
        expect(formatDelta(-12.4)).toContain("−");
    });

    it("signs a gain", () => {
        expect(formatDelta(3)).toBe("+3%");
    });

    // Deriving the sign from `delta > 0` printed "−0%", which reads as a small loss.
    it("leaves zero unsigned", () => {
        expect(formatDelta(0)).toBe("0%");
        expect(formatDelta(0.4)).toBe("0%");
        expect(formatDelta(-0.4)).toBe("0%");
    });

    it("is empty when the swing is unknown", () => {
        expect(formatDelta(null)).toBe("");
        expect(formatDelta(undefined)).toBe("");
    });
});
