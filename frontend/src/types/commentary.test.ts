import { describe, expect, it } from "vitest";

import {
    CUSTOM_INSTRUCTION_MAX,
    MAX_TOKEN_MAX,
    MAX_TOKEN_MIN,
    NUM_COMMENTS_MAX,
    NUM_COMMENTS_MIN,
} from "@/constants/commentary/config";
import {
    DEFAULT_COMMENTARY_CONFIG,
    readCommentaryConfig,
} from "@/types/commentary";

describe("readCommentaryConfig", () => {
    it("falls back to the defaults when there are no preferences", () => {
        expect(readCommentaryConfig(null)).toEqual(DEFAULT_COMMENTARY_CONFIG);
        expect(readCommentaryConfig(undefined)).toEqual(
            DEFAULT_COMMENTARY_CONFIG
        );
        expect(readCommentaryConfig({})).toEqual(DEFAULT_COMMENTARY_CONFIG);
    });

    it("reads a fully populated saved config", () => {
        const saved = {
            model: "claude-opus-5",
            language: "japanese",
            num_comments: 42,
            max_token: 4096,
            custom_instruction: "Mention joseki names.",
        };
        expect(readCommentaryConfig({ commentary_config: saved })).toEqual(
            saved
        );
    });

    it("rejects a model the backend no longer accepts", () => {
        // A preference saved before the model IDs were corrected still holds a
        // stale value; forwarding it raw would earn a 400 from the backend.
        const config = readCommentaryConfig({
            commentary_config: { model: "claude-3-5-sonnet" },
        });
        expect(config.model).toBe(DEFAULT_COMMENTARY_CONFIG.model);
    });

    it("rejects an unsupported language", () => {
        const config = readCommentaryConfig({
            commentary_config: { language: "klingon" },
        });
        expect(config.language).toBe(DEFAULT_COMMENTARY_CONFIG.language);
    });

    it("falls back for counts that cannot be read as numbers", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: "many", max_token: "lots" },
        });
        expect(config.num_comments).toBe(
            DEFAULT_COMMENTARY_CONFIG.num_comments
        );
        expect(config.max_token).toBe(DEFAULT_COMMENTARY_CONFIG.max_token);
    });

    it("falls back for counts that coerce to zero", () => {
        // `Number(null)`, `Number("")` and `Number([])` are all 0 — finite, but
        // below every bound the backend accepts (`num_comments` is ge=1,
        // `max_token` ge=256), so forwarding them would earn a 400.
        for (const empty of [null, "", []]) {
            const config = readCommentaryConfig({
                commentary_config: { num_comments: empty, max_token: empty },
            });
            expect(config.num_comments).toBe(
                DEFAULT_COMMENTARY_CONFIG.num_comments
            );
            expect(config.max_token).toBe(DEFAULT_COMMENTARY_CONFIG.max_token);
        }
    });

    it("falls back for negative counts", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: -5, max_token: -512 },
        });
        expect(config.num_comments).toBe(
            DEFAULT_COMMENTARY_CONFIG.num_comments
        );
        expect(config.max_token).toBe(DEFAULT_COMMENTARY_CONFIG.max_token);
    });

    it("clamps counts to the bounds the backend enforces", () => {
        const tooHigh = readCommentaryConfig({
            commentary_config: { num_comments: 500, max_token: 100000 },
        });
        expect(tooHigh.num_comments).toBe(NUM_COMMENTS_MAX);
        expect(tooHigh.max_token).toBe(MAX_TOKEN_MAX);

        const tooLow = readCommentaryConfig({
            commentary_config: { num_comments: 0.5, max_token: 10 },
        });
        expect(tooLow.num_comments).toBe(NUM_COMMENTS_MIN);
        expect(tooLow.max_token).toBe(MAX_TOKEN_MIN);
    });

    it("rounds fractional counts to integers", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: 12.6, max_token: 1024.4 },
        });
        expect(config.num_comments).toBe(13);
        expect(config.max_token).toBe(1024);
    });

    it("truncates an over-long custom instruction", () => {
        const config = readCommentaryConfig({
            commentary_config: {
                custom_instruction: "x".repeat(CUSTOM_INSTRUCTION_MAX + 50),
            },
        });
        expect(config.custom_instruction).toHaveLength(CUSTOM_INSTRUCTION_MAX);
    });

    it("accepts a numeric count supplied as a string", () => {
        const config = readCommentaryConfig({
            commentary_config: { num_comments: "15" },
        });
        expect(config.num_comments).toBe(15);
    });

    it("falls back when the custom instruction is not a string", () => {
        const config = readCommentaryConfig({
            commentary_config: { custom_instruction: 42 },
        });
        expect(config.custom_instruction).toBe("");
    });

    it("keeps an empty custom instruction rather than treating it as missing", () => {
        const config = readCommentaryConfig({
            commentary_config: { custom_instruction: "" },
        });
        expect(config.custom_instruction).toBe("");
    });

    it("ignores unrelated preference sections", () => {
        const config = readCommentaryConfig({
            theme: "dark",
            commentary_config: { model: "claude-haiku-4-5" },
        });
        expect(config.model).toBe("claude-haiku-4-5");
        expect(config.language).toBe(DEFAULT_COMMENTARY_CONFIG.language);
    });

    it("does not mutate the caller's preferences", () => {
        const preferences = { commentary_config: { model: "claude-opus-5" } };
        readCommentaryConfig(preferences);
        expect(preferences).toEqual({
            commentary_config: { model: "claude-opus-5" },
        });
    });
});
