// Wire shapes for the Kifu-Sensei backend.
//
// SOURCE OF TRUTH: `backend/app/schemas.py`. These used to exist twice — once in
// `frontend/src/types/commentary.ts` and once in `extension/src/shared/types.ts` —
// and the copies had drifted in both optionality and membership.

/** `[colour, [row, col]]`, or a null point for a pass. Row 0 is the bottom edge. */
export type GameMove = [string, [number, number] | null];

/** A pass carries no coordinate, so narrow before indexing into one. */
export function isValidMove(
    move: GameMove
): move is [string, [number, number]] {
    const [, coords] = move;
    return coords !== null;
}

export type ClaudeModel =
    "claude-fable-5" | "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5";

export type CommentaryLanguage =
    "english" | "chinese (simplified)" | "japanese" | "korean";

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
     * means the move lost win rate. Nullable because commentaries saved before this
     * field existed are replayed from the database without it — the backend's
     * `CommentaryItemSchema` always serialises the key, defaulting to `null` rather
     * than omitting it, so the key is required and the value is not.
     */
    winrate_delta: number | null;
    /** Colour of the player who made this move. Nullable for the same reason. */
    color: "B" | "W" | null;
}

export interface CommentaryResponse {
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
}

/**
 * Summary shape returned by the history *list* endpoint — everything a row and its
 * board thumbnail need, but not the comment text or the annotated SGF. Fetch
 * `ENDPOINTS.userCommentaryHistoryDetail(id)` for the rest of a specific entry.
 */
export interface CommentaryHistoryItem {
    id: number;
    board_size: number;
    sgf_file_name: string;
    language: CommentaryLanguage;
    model?: ClaudeModel | null;
    created_at: string;
    moves: GameMove[];
    initial_stones: GameMove[];
    comment_count: number;
}

export interface UserCommentaryHistory {
    commentaries: CommentaryHistoryItem[];
    total: number;
}

// ── Failures ────────────────────────────────────────────────────────────────

/**
 * Machine-readable failure codes from the commentary endpoints. Branch on these
 * rather than on `detail`, which is prose and may be reworded.
 *
 * Mirrors the `code` literal on the backend's `CommentaryErrorResponse` — all nine
 * of them. Both clients previously listed only seven, omitting the two the job path
 * raises, which meant a 409 lost its code on the way in and the panel offered a
 * "Try Again" button that could only earn the same 409.
 */
export type CommentaryErrorCode =
    | "no_api_key"
    | "invalid_sgf"
    | "upstream_rate_limited"
    | "upstream_auth_failed"
    | "upstream_error"
    | "katago_unavailable"
    | "job_already_running"
    | "job_abandoned"
    | "internal_error";

export const COMMENTARY_ERROR_CODES: readonly CommentaryErrorCode[] = [
    "no_api_key",
    "invalid_sgf",
    "upstream_rate_limited",
    "upstream_auth_failed",
    "upstream_error",
    "katago_unavailable",
    "job_already_running",
    "job_abandoned",
    "internal_error",
];

export function isCommentaryErrorCode(
    value: unknown
): value is CommentaryErrorCode {
    return COMMENTARY_ERROR_CODES.includes(value as CommentaryErrorCode);
}

/**
 * Failures a client can hit that the backend has no code for, because they happen
 * before or instead of a response.
 */
export type ClientErrorCode =
    "session_expired" | "network" | "timeout" | "sgf_unavailable";

/** Every code either surface must be able to explain. */
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
    /**
     * `code` is typed as a plain string rather than `CommentaryErrorCode`: it comes
     * straight off the wire, and claiming the backend can only ever send a member of
     * the union is exactly the assumption that let `job_abandoned` through unchecked.
     * Narrow it with {@link isCommentaryErrorCode} before branching.
     */
    error: {
        detail: string;
        code: string;
        retry_after: number | null;
    } | null;
}
