/**
 * types.ts
 *
 * Single source of truth for all TypeScript types shared across the extension's
 * three contexts: content scripts, background service worker, and the side panel.
 *
 * Divided into four sections:
 *   1. Auth state machine
 *   2. chrome.storage.local schema
 *   3. Backend API shapes (mirroring backend/app/schemas.py exactly)
 *   4. Extension messaging contracts (content ↔ background ↔ panel)
 */

// ---------------------------------------------------------------------------
// 1. Auth state machine
// ---------------------------------------------------------------------------

/**
 * The three states defined in spec section 3.3. Every screen in the side panel
 * and every variant of the injected button derives from one of these states.
 *
 * We use `as const` rather than an enum so that the string values are
 * preserved at runtime (enums compile to numeric values by default) and the
 * type is narrowable with a plain equality check.
 */
export const AuthStates = {
    /** No account. No JWT in chrome.storage.local. */
    UNAUTHENTICATED: "UNAUTHENTICATED",
    /** Has account and valid JWT, but has_api_key === false in storage. */
    AUTH_NO_KEY: "AUTH_NO_KEY",
    /** Has account, valid JWT, and has_api_key === true. Ready to generate. */
    READY: "READY",
} as const;

/** Union of the three auth state string literals. */
export type AuthState = (typeof AuthStates)[keyof typeof AuthStates];

// ---------------------------------------------------------------------------
// 2. chrome.storage.local schema
// ---------------------------------------------------------------------------

/**
 * The complete shape of what this extension writes to chrome.storage.local.
 *
 * Using a single interface here means every read/write goes through one
 * definition, making key renames easy to catch at compile time.
 *
 * Key mapping note: the backend field `has_claude_api_key` is stored under
 * the shorter `has_api_key` key to keep chrome.storage reads concise.
 */
export interface ExtensionStorage {
    /** JWT access token. Absent when the user is not logged in. */
    jwt: string;
    /** JWT refresh token. Used by the background worker to silently re-auth. */
    refresh_token: string;
    /**
     * Mirrors `has_claude_api_key` from GET /auth/user/settings/.
     * Stored locally so content scripts can derive auth state without a
     * network round-trip on every OGS page load.
     */
    has_api_key: boolean;
    /** The user's email, stored for display in the panel header. */
    user_email: string;
}

// ---------------------------------------------------------------------------
// 3. Backend API shapes
// ---------------------------------------------------------------------------
// These mirror backend/app/schemas.py. Field names must match exactly.
// When the backend schema changes, update here first — TypeScript will then
// flag every callsite that needs updating.

/** Returned by POST /auth/token/ and POST /auth/token/refresh/. */
export interface TokenPairResponse {
    access: string;
    refresh: string;
    user: UserPublic;
}

/** The public-facing user object embedded in TokenPairResponse. */
export interface UserPublic {
    id: number;
    email: string;
    preferences: Record<string, unknown>;
    has_claude_api_key: boolean;
}

/** Returned by GET /auth/user/settings/ and PUT /auth/user/claude-api-key/. */
export interface UserSettingsResponse {
    preferences: Record<string, unknown>;
    has_claude_api_key: boolean;
    /**
     * Trial game accounting (spec section 6.3).
     * Not yet present in backend/app/schemas.py — typed as optional so the
     * extension compiles today and automatically picks up the values once the
     * backend adds them.
     */
    trial_games_used?: number;
    trial_games_limit?: number;
}

/** Returned by POST /auth/register/. */
export interface DetailResponse {
    detail: string;
}

/** Request body for POST /api/commentary/. */
export interface GenerateCommentaryRequest {
    sgf_content: string;
    sgf_file_name: string;
    model: "claude-opus-4-8" | "claude-sonnet-4-6" | "claude-haiku-4-5";
    language: "english" | "chinese (simplified)" | "japanese" | "korean";
    num_comments: number;
    max_token: number;
    custom_instruction: string;
}

/** A single commented move within a GenerateCommentaryResponse. */
export interface CommentaryItem {
    turn: number;
    comment: string;
}

/** Returned by POST /api/commentary/. */
export interface GenerateCommentaryResponse {
    board_size: number;
    sgf_file_name: string;
    language: string;
    moves: [string, [number, number]][];
    initial_stones: [string, [number, number]][];
    comments: CommentaryItem[];
    annotated_sgf_content: string;
}

// ---------------------------------------------------------------------------
// 4. Extension messaging contracts
// ---------------------------------------------------------------------------
// All chrome.runtime.sendMessage / onMessage traffic in the extension uses
// these tagged union types. The `type` field acts as a discriminant so
// listeners can narrow to the correct payload shape with a simple switch.

/**
 * Sent by the content script to ask the background worker to open the
 * Chrome Side Panel for a specific OGS game.
 * The background worker calls chrome.sidePanel.open() (requires window ID,
 * which only the background context knows reliably) and stores the game ID
 * so the panel can retrieve it on first render.
 */
export interface OpenSidePanelMessage {
    type: "OPEN_SIDE_PANEL";
    payload: { gameId: number };
}

/**
 * Broadcast by the background worker to all tabs when the user's auth state
 * changes (e.g. they just completed registration via the extension-ready page).
 * The content script listens for this to update the injected button variant
 * without requiring a page reload.
 */
export interface AuthStateChangedMessage {
    type: "AUTH_STATE_CHANGED";
    payload: { authState: AuthState };
}

/**
 * Sent by the background worker to the side panel immediately after opening it.
 * Delivers the OGS game ID so the panel knows which game to analyse.
 */
export interface GameContextMessage {
    type: "GAME_CONTEXT";
    payload: { gameId: number };
}

/** Discriminated union of every message type used in this extension. */
export type ExtensionMessage =
    | OpenSidePanelMessage
    | AuthStateChangedMessage
    | GameContextMessage;
