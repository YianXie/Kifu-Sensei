// Commentary configuration: the selectable models and languages, the bounds the
// backend enforces, and the helpers for turning a stored preference into a request.
//
// SOURCE OF TRUTH: `GenerateCommentaryRequest` in `backend/app/schemas.py`. This is a
// third copy of the same lists — the other is `frontend/src/types/commentary.ts`. When
// the backend `Literal`s change, all three must change together. A build-time
// generator from the OpenAPI schema would remove the duplication; until then, the
// backend rejects anything out of step with a 400, so drift fails loudly rather than
// silently sending an unsupported model.
import type { GameMove } from "./types";

/**
 * Declared as a const array and the union derived from it, rather than the other way
 * round, so the runtime list and the type cannot disagree.
 */
export const CLAUDE_MODELS = [
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5",
] as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const COMMENTARY_LANGUAGES = [
    "english",
    "chinese (simplified)",
    "japanese",
    "korean",
] as const;

export type CommentaryLanguage = (typeof COMMENTARY_LANGUAGES)[number];

/** Human-readable labels for the model picker. */
export const CLAUDE_MODEL_LABELS: Record<ClaudeModel, string> = {
    "claude-fable-5": "Claude Fable 5",
    "claude-opus-5": "Claude Opus 5",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-haiku-4-5": "Claude Haiku 4.5",
};

export const COMMENTARY_LANGUAGE_LABELS: Record<CommentaryLanguage, string> = {
    english: "English",
    "chinese (simplified)": "Chinese (simplified)",
    japanese: "Japanese",
    korean: "Korean",
};

// Mirrors the `Field(ge=..., le=..., max_length=...)` bounds on
// `GenerateCommentaryRequest`. Checked client-side so an out-of-range value is caught
// before a request is spent, not after a 400.
export const NUM_COMMENTS_MIN = 1;
export const NUM_COMMENTS_MAX = 100;
export const MAX_TOKEN_MIN = 256;
export const MAX_TOKEN_MAX = 8192;
export const CUSTOM_INSTRUCTION_MAX = 1000;

export interface CommentaryConfig {
    model: ClaudeModel;
    language: CommentaryLanguage;
    num_comments: number;
    max_token: number;
    custom_instruction: string;
}

export const DEFAULT_COMMENTARY_CONFIG: CommentaryConfig = {
    model: "claude-sonnet-5",
    language: "english",
    num_comments: 20,
    max_token: 1024,
    custom_instruction: "",
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function isClaudeModel(value: unknown): value is ClaudeModel {
    return CLAUDE_MODELS.includes(value as ClaudeModel);
}

function isCommentaryLanguage(value: unknown): value is CommentaryLanguage {
    return COMMENTARY_LANGUAGES.includes(value as CommentaryLanguage);
}

/**
 * Resolve a saved commentary config out of a user's free-form preferences blob,
 * falling back to {@link DEFAULT_COMMENTARY_CONFIG} for anything missing or malformed.
 *
 * Every field is validated rather than passed through: a preference saved before the
 * model IDs were corrected still holds a stale value, and forwarding it raw would be
 * rejected by the backend's `Literal`. Port of `readCommentaryConfig` in
 * `frontend/src/types/commentary.ts`.
 */
export function readCommentaryConfig(
    preferences: Record<string, unknown> | null | undefined
): CommentaryConfig {
    const raw = (preferences?.commentary_config ?? {}) as Record<
        string,
        unknown
    >;
    const numComments = Number(raw.num_comments);
    const maxToken = Number(raw.max_token);
    const customInstruction = raw.custom_instruction;

    return clampCommentaryConfig({
        model: isClaudeModel(raw.model)
            ? raw.model
            : DEFAULT_COMMENTARY_CONFIG.model,
        language: isCommentaryLanguage(raw.language)
            ? raw.language
            : DEFAULT_COMMENTARY_CONFIG.language,
        num_comments: Number.isFinite(numComments)
            ? numComments
            : DEFAULT_COMMENTARY_CONFIG.num_comments,
        max_token: Number.isFinite(maxToken)
            ? maxToken
            : DEFAULT_COMMENTARY_CONFIG.max_token,
        custom_instruction:
            typeof customInstruction === "string"
                ? customInstruction
                : DEFAULT_COMMENTARY_CONFIG.custom_instruction,
    });
}

/** Force a config inside the bounds the backend enforces. */
export function clampCommentaryConfig(
    config: CommentaryConfig
): CommentaryConfig {
    return {
        ...config,
        num_comments: Math.round(
            clamp(config.num_comments, NUM_COMMENTS_MIN, NUM_COMMENTS_MAX)
        ),
        max_token: Math.round(
            clamp(config.max_token, MAX_TOKEN_MIN, MAX_TOKEN_MAX)
        ),
        custom_instruction: config.custom_instruction.slice(
            0,
            CUSTOM_INSTRUCTION_MAX
        ),
    };
}

export type CommentarySeverity = "blunder" | "mistake" | "notable";

/**
 * Map a win-rate swing onto the card styling tiers.
 *
 * Thresholds live here rather than on the server: the tier is a display concern, and
 * baking it into the API would freeze it into every stored commentary. `undefined`
 * covers commentaries saved before `winrate_delta` existed.
 */
export function severityForDelta(
    delta: number | null | undefined
): CommentarySeverity {
    if (delta === null || delta === undefined) {
        return "notable";
    }
    if (delta <= -10) {
        return "blunder";
    }
    if (delta <= -5) {
        return "mistake";
    }
    return "notable";
}

/**
 * Colour of the player who made a given move.
 *
 * Read from the move list, never inferred from turn parity: a handicap game puts its
 * stones in `initial_stones` and opens with White, so parity is inverted for the whole
 * game. `fallback` is the `color` field on the comment, which older stored
 * commentaries lack.
 */
export function colorForTurn(
    moves: GameMove[],
    turn: number,
    fallback?: "B" | "W" | null
): "B" | "W" {
    const fromMoves = moves[turn - 1]?.[0];
    if (fromMoves === "B" || fromMoves === "W") {
        return fromMoves;
    }
    return fallback === "B" || fallback === "W" ? fallback : "B";
}

/** Render a swing as the badge text, e.g. `-18%`. Empty when unknown. */
export function formatDelta(delta: number | null | undefined): string {
    if (delta === null || delta === undefined) {
        return "";
    }
    return `${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta))}%`;
}
