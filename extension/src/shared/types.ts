import type { ClaudeModel, CommentaryLanguage } from "./commentary";

export interface ExtensionAuthObject {
    accessToken: string;
    refreshToken: string;
}

// ── Backend commentary API ──────────────────────────────────────────────────
// Mirrors the response models in `backend/app/schemas.py`.

/** `[colour, [row, col]]`, or a null point for a pass. Row 0 is the bottom edge. */
export type GameMove = [string, [number, number] | null];

export interface CommentaryUsage {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
}

export interface CommentaryItem {
    turn: number;
    comment: string;
    /**
     * Win-rate change in percentage points from the mover's perspective; negative
     * means the move lost win rate. Optional: commentaries saved before this field
     * existed are replayed from the database without it.
     */
    winrate_delta?: number | null;
    /** Colour that played this move. Optional for the same reason. */
    color?: "B" | "W" | null;
}

export interface CommentaryResponse {
    board_size: number;
    sgf_file_name: string;
    language: CommentaryLanguage;
    model?: ClaudeModel | null;
    usage?: CommentaryUsage | null;
    moves: GameMove[];
    initial_stones: GameMove[];
    comments: CommentaryItem[];
    annotated_sgf_content: string;
}

/**
 * Machine-readable failure codes. Branch on these rather than on `detail`, which is
 * prose. Mirrors the `code` literal on the backend's `CommentaryErrorResponse`.
 */
export type CommentaryErrorCode =
    | "no_api_key"
    | "invalid_sgf"
    | "upstream_rate_limited"
    | "upstream_auth_failed"
    | "upstream_error"
    | "katago_unavailable"
    | "internal_error";

/**
 * Failures the panel can encounter that the backend has no code for, because they
 * happen before or instead of a response.
 */
export type ClientErrorCode =
    "session_expired" | "network" | "timeout" | "sgf_unavailable";

/** Every code the panel's error screen must be able to explain. */
export type PanelErrorCode = CommentaryErrorCode | ClientErrorCode;

/** Normalised failure, whether it came from the backend, the network, or a timeout. */
export interface CommentaryApiError {
    /** `null` when the failure has no code worth branching on. */
    code: PanelErrorCode | null;
    detail: string;
    retryAfter: number | null;
}

// ── Async job endpoints ─────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface CommentaryJobCreated {
    job_id: string;
    status: JobStatus;
}

export interface CommentaryJobProgress {
    done: number;
    total: number;
}

export interface CommentaryJobState {
    job_id: string;
    status: JobStatus;
    progress: CommentaryJobProgress;
    result: CommentaryResponse | null;
    error: {
        detail: string;
        code: CommentaryErrorCode;
        retry_after: number | null;
    } | null;
}

// ── OGS ─────────────────────────────────────────────────────────────────────

/**
 * The subset of `GET /api/v1/games/{id}` this extension reads.
 *
 * `ended` is null while a game is in progress. `gamedata.phase` is the authoritative
 * signal — `"play"` and `"stone removal"` both mean not finished.
 */
export interface OgsGameSummary {
    id: number;
    ended: string | null;
    width: number;
    height: number;
    handicap: number;
    disable_analysis: boolean;
    gamedata?: {
        phase?: "play" | "stone removal" | "finished";
        /**
         * Every move played. Handicap stones are in `initial_state`, not here, so the
         * length is the real move count — and the ceiling on how many comments are
         * worth asking for.
         */
        moves?: unknown[];
    };
}
