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
    formatDelta,
    readCommentaryConfig,
    severityForDelta,
} from "./commentary";
import type { GameMove } from "./types";

describe("model and language lists", () => {
    it("labels every model and language", () => {
        // A missing label renders as `undefined` in the picker.
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
        expect(readCommentaryConfig(null)).toEqual(DEFAULT_COMMENTARY_CONFIG);
        expect(readCommentaryConfig(undefined)).toEqual(
            DEFAULT_COMMENTARY_CONFIG
        );
        expect(readCommentaryConfig({})).toEqual(DEFAULT_COMMENTARY_CONFIG);
    });

    it("reads a fully populated saved config", () => {
        const saved = {
            model: "claude-opus-5",
            language: "korean",
            num_comments: 30,
            max_token: 2048,
            custom_instruction: "Mention joseki names.",
        };
        expect(readCommentaryConfig({ commentary_config: saved })).toEqual(
            saved
        );
    });

    it("discards a model the backend no longer accepts", () => {
        // Forwarding a stale ID raw would be rejected by the backend's Literal.
        const config = readCommentaryConfig({
            commentary_config: { model: "claude-3-5-sonnet" },
        });
        expect(config.model).toBe(DEFAULT_COMMENTARY_CONFIG.model);
    });

    it("discards an unsupported language", () => {
        const config = readCommentaryConfig({
            commentary_config: { language: "klingon" },
        });
        expect(config.language).toBe(DEFAULT_COMMENTARY_CONFIG.language);
    });

    it("clamps saved values that fall outside the backend's bounds", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: 9999, max_token: 1 },
        });
        expect(config.num_comments).toBe(NUM_COMMENTS_MAX);
        expect(config.max_token).toBe(MAX_TOKEN_MIN);
    });

    it("clamps a null count instead of sending 0", () => {
        // `Number(null)` is 0, which is finite and so survives the guard —
        // clamping is what stops it reaching the backend as an invalid value.
        const config = readCommentaryConfig({
            commentary_config: { num_comments: null, max_token: null },
        });
        expect(config.num_comments).toBe(NUM_COMMENTS_MIN);
        expect(config.max_token).toBe(MAX_TOKEN_MIN);
    });

    it("falls back for a count that is not a number at all", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: "many" },
        });
        expect(config.num_comments).toBe(
            DEFAULT_COMMENTARY_CONFIG.num_comments
        );
    });

    it("truncates an over-long custom instruction", () => {
        const config = readCommentaryConfig({
            commentary_config: { custom_instruction: "x".repeat(5000) },
        });
        expect(config.custom_instruction).toHaveLength(CUSTOM_INSTRUCTION_MAX);
    });

    it("falls back when the custom instruction is not a string", () => {
        const config = readCommentaryConfig({
            commentary_config: { custom_instruction: 42 },
        });
        expect(config.custom_instruction).toBe("");
    });
});

describe("clampCommentaryConfig", () => {
    it("leaves an in-range config alone", () => {
        expect(clampCommentaryConfig(DEFAULT_COMMENTARY_CONFIG)).toEqual(
            DEFAULT_COMMENTARY_CONFIG
        );
    });

    it("pulls values back inside the bounds", () => {
        const clamped = clampCommentaryConfig({
            ...DEFAULT_COMMENTARY_CONFIG,
            num_comments: -5,
            max_token: 999_999,
        });
        expect(clamped.num_comments).toBe(NUM_COMMENTS_MIN);
        expect(clamped.max_token).toBe(MAX_TOKEN_MAX);
    });

    it("rounds fractional counts, which the backend types as ints", () => {
        const clamped = clampCommentaryConfig({
            ...DEFAULT_COMMENTARY_CONFIG,
            num_comments: 20.6,
            max_token: 1024.4,
        });
        expect(clamped.num_comments).toBe(21);
        expect(clamped.max_token).toBe(1024);
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
    ])("maps %d to %s", (delta, expected) => {
        expect(severityForDelta(delta)).toBe(expected);
    });

    it("treats an unknown delta as merely notable", () => {
        // Commentaries saved before `winrate_delta` existed have no value; a
        // default of "blunder" would mislabel every one of them.
        expect(severityForDelta(null)).toBe("notable");
        expect(severityForDelta(undefined)).toBe("notable");
    });
});

describe("colorForTurn", () => {
    const evenGame: GameMove[] = [
        ["B", [3, 3]],
        ["W", [15, 15]],
        ["B", [3, 15]],
    ];

    it("reads the colour off the move list", () => {
        expect(colorForTurn(evenGame, 1)).toBe("B");
        expect(colorForTurn(evenGame, 2)).toBe("W");
        expect(colorForTurn(evenGame, 3)).toBe("B");
    });

    it("gets a handicap game right, where parity would be inverted", () => {
        // Handicap stones sit in `initial_stones`, so the game opens with White.
        const handicap: GameMove[] = [
            ["W", [3, 3]],
            ["B", [15, 15]],
        ];
        expect(colorForTurn(handicap, 1)).toBe("W");
        expect(colorForTurn(handicap, 2)).toBe("B");
    });

    it("uses the stored fallback when the move list is short", () => {
        expect(colorForTurn([], 5, "W")).toBe("W");
    });

    it("falls back to Black when nothing else is known", () => {
        expect(colorForTurn([], 5)).toBe("B");
        expect(colorForTurn([], 5, null)).toBe("B");
    });

    it("prefers the move list over the stored fallback", () => {
        expect(colorForTurn(evenGame, 2, "B")).toBe("W");
    });
});

describe("formatDelta", () => {
    it("renders a loss with a minus sign", () => {
        expect(formatDelta(-18)).toBe("−18%");
    });

    it("renders a gain with a plus sign", () => {
        expect(formatDelta(4.6)).toBe("+5%");
    });

    it("rounds to whole percentage points", () => {
        expect(formatDelta(-18.4)).toBe("−18%");
        expect(formatDelta(-18.6)).toBe("−19%");
    });

    it("renders zero without a plus", () => {
        expect(formatDelta(0)).toBe("−0%");
    });

    it("renders nothing when the delta is unknown", () => {
        expect(formatDelta(null)).toBe("");
        expect(formatDelta(undefined)).toBe("");
    });
});
