import type { GameMove } from "@/types/game";

export type ClaudeModel =
    | "claude-opus-4-8"
    | "claude-sonnet-4-6"
    | "claude-haiku-4-5";

export type CommentaryConfigValues = {
    model: ClaudeModel;
    num_comments: number;
    max_token: number;
    custom_instruction: string;
};

export const DEFAULT_COMMENTARY_CONFIG: CommentaryConfigValues = {
    model: "claude-haiku-4-5",
    num_comments: 20,
    max_token: 1024,
    custom_instruction: "",
};

const CLAUDE_MODELS: ClaudeModel[] = [
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
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
    const numComments = Number(raw.num_comments);
    const maxToken = Number(raw.max_token);
    const customInstruction = raw.custom_instruction;
    return {
        model: CLAUDE_MODELS.includes(model)
            ? model
            : DEFAULT_COMMENTARY_CONFIG.model,
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
};

export type CommentaryResponse = {
    board_size: number;
    moves: GameMove[];
    initial_stones: GameMove[];
    comments: CommentaryItem[];
    annotated_sgf_content: string | null;
};
