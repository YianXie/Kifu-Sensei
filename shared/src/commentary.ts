// Commentary configuration and the display rules both surfaces must agree on.
//
// SOURCE OF TRUTH for the lists and bounds: `GenerateCommentaryRequest` in
// `backend/app/schemas.py`. This was previously three copies — two clients plus the
// backend — and the client pair had drifted. It is now two, and the backend rejects
// anything out of step with a 400, so drift fails loudly.
import { GTP_LETTERS } from "./go";
import type { ClaudeModel, CommentaryLanguage, GameMove } from "./types";

/**
 * Declared as a const array with the union derived from it, rather than the other
 * way round, so the runtime list and the type cannot disagree.
 */
export const CLAUDE_MODELS = [
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5",
] as const satisfies readonly ClaudeModel[];

export const COMMENTARY_LANGUAGES = [
    "english",
    "chinese (simplified)",
    "japanese",
    "korean",
] as const satisfies readonly CommentaryLanguage[];

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
    return (CLAUDE_MODELS as readonly string[]).includes(value as string);
}

function isCommentaryLanguage(value: unknown): value is CommentaryLanguage {
    return (COMMENTARY_LANGUAGES as readonly string[]).includes(
        value as string
    );
}

/**
 * A count is only usable if it reads as a finite *positive* number.
 *
 * `Number(null)`, `Number("")` and `Number([])` are all 0 — finite, but below every
 * bound the backend accepts. The extension used to guard with a bare
 * `Number.isFinite`, so it forwarded that 0 and `clampCommentaryConfig` pulled it up
 * to the minimum: the same saved preference produced 20 comments on the website and
 * 1 in the panel. Falling back to the default is the correct reading of "this value
 * is unusable".
 */
function isPositiveNumber(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

/**
 * Resolve a commentary config out of a user's free-form preferences blob, falling
 * back to {@link DEFAULT_COMMENTARY_CONFIG} for anything missing or malformed.
 *
 * Every field is validated rather than passed through: a preference saved before the
 * model IDs were corrected still holds a stale value, and forwarding it raw would be
 * rejected by the backend's `Literal`.
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
        num_comments: isPositiveNumber(numComments)
            ? numComments
            : DEFAULT_COMMENTARY_CONFIG.num_comments,
        max_token: isPositiveNumber(maxToken)
            ? maxToken
            : DEFAULT_COMMENTARY_CONFIG.max_token,
        custom_instruction:
            typeof customInstruction === "string"
                ? customInstruction
                : DEFAULT_COMMENTARY_CONFIG.custom_instruction,
    });
}

/**
 * Force a config inside the bounds the backend enforces, so a preference saved when
 * the bounds were wider is corrected rather than rejected with a 400.
 */
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

// ── Display rules ───────────────────────────────────────────────────────────

export type CommentarySeverity = "blunder" | "mistake" | "notable";

/**
 * Map a win-rate swing onto the card styling tiers.
 *
 * Thresholds live here rather than on the server: the tier is a display concern, and
 * baking it into the API would freeze it into every stored commentary.
 * `null`/`undefined` covers commentaries saved before `winrate_delta` existed.
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

/** The word for a severity tier, so it is never conveyed by colour alone. */
export const SEVERITY_LABELS: Record<CommentarySeverity, string> = {
    blunder: "Blunder",
    mistake: "Mistake",
    notable: "Notable",
};

/**
 * Colour of the player who made a given move.
 *
 * Read from the move list, never inferred from turn parity: a handicap game puts its
 * stones in `initial_stones` and opens with White, so parity is inverted for the
 * whole game. `fallback` is the `color` field on the comment, which older stored
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

/** The word for a stone colour. */
export const COLOR_LABELS: Record<"B" | "W", string> = {
    B: "Black",
    W: "White",
};

/**
 * GTP coordinate of the stone played on `turn`, e.g. `"Q4"`. Empty for a pass, or
 * for a turn outside the game.
 */
export function coordinateForTurn(moves: GameMove[], turn: number): string {
    const coords = moves[turn - 1]?.[1];
    if (!coords) return "";
    const [row, col] = coords;
    return `${GTP_LETTERS[col] ?? col + 1}${row + 1}`;
}

/**
 * Render a swing as badge text, e.g. `-18%`, `+3%`, `0%`.
 *
 * Uses U+2212 MINUS SIGN rather than a hyphen so the glyph matches the `+`. Zero is
 * signless: deriving the sign from `delta > 0` used to print `-0%`, which reads as a
 * small loss rather than as no change.
 */
export function formatDelta(delta: number | null | undefined): string {
    if (delta === null || delta === undefined) {
        return "";
    }
    const rounded = Math.round(delta);
    const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
    return `${sign}${Math.abs(rounded)}%`;
}
