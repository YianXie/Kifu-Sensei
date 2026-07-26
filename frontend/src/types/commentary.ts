import type { GameMove } from "@/types/game";

export type ClaudeModel =
    | "claude-fable-5"
    | "claude-opus-5"
    | "claude-sonnet-5"
    | "claude-haiku-4-5";

/**
 * Machine-readable failure codes from `POST /api/commentary/`. Mirrors the `code`
 * literal on the backend's `CommentaryErrorResponse` — branch on this rather than on
 * `detail`, which is prose and may be reworded.
 */
export type CommentaryErrorCode =
    | "no_api_key"
    | "invalid_sgf"
    | "upstream_rate_limited"
    | "upstream_auth_failed"
    | "upstream_error"
    | "katago_unavailable"
    | "internal_error";

export type CommentaryLanguage =
    | "english"
    | "chinese (simplified)"
    | "japanese"
    | "korean";

export type CommentaryConfigValues = {
    model: ClaudeModel;
    language: CommentaryLanguage;
    num_comments: number;
    max_token: number;
    custom_instruction: string;
};

export const DEFAULT_COMMENTARY_CONFIG: CommentaryConfigValues = {
    model: "claude-sonnet-5",
    language: "english",
    num_comments: 20,
    max_token: 1024,
    custom_instruction: "",
};

const CLAUDE_MODELS: ClaudeModel[] = [
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5",
];

const COMMENTARY_LANGUAGES: CommentaryLanguage[] = [
    "english",
    "chinese (simplified)",
    "japanese",
    "korean",
];

/**
 * Resolve a user's saved default commentary config out of their free-form
 * preferences blob, falling back to {@link DEFAULT_COMMENTARY_CONFIG} for any
 * missing or malformed field.
 */
export function readCommentaryConfig(
    preferences: Record<string, unknown> | null | undefined
): CommentaryConfigValues {
    const raw = (preferences?.commentary_config ?? {}) as Record<
        string,
        unknown
    >;
    const model = raw.model as ClaudeModel;
    const language = raw.language as CommentaryLanguage;
    const numComments = Number(raw.num_comments);
    const maxToken = Number(raw.max_token);
    const customInstruction = raw.custom_instruction;
    return {
        model: CLAUDE_MODELS.includes(model)
            ? model
            : DEFAULT_COMMENTARY_CONFIG.model,
        language: COMMENTARY_LANGUAGES.includes(language)
            ? language
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
    };
}

export type CommentaryItem = {
    turn: number;
    comment: string;
    /**
     * Win-rate change in percentage points from the mover's perspective; negative
     * means the move lost win rate. Optional because commentaries saved before this
     * field existed are replayed from the database without it.
     */
    winrate_delta?: number;
    /** Colour of the player who made this move. Optional for the same reason. */
    color?: "B" | "W";
};

export type CommentaryUsage = {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
};

export type CommentaryResponse = {
    board_size: number;
    sgf_file_name: string;
    language: CommentaryLanguage;
    /**
     * Claude model that produced the commentary, and the tokens it consumed.
     * Optional because commentaries saved before these fields existed are replayed
     * from the database without them.
     */
    model?: ClaudeModel | null;
    usage?: CommentaryUsage | null;
    moves: GameMove[];
    initial_stones: GameMove[];
    comments: CommentaryItem[];
    annotated_sgf_content: string;
};
