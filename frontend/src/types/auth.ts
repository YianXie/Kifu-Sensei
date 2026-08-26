import type { CommentaryHistoryItem, ProviderName } from "@shared/types";

export interface AIProviderSettings {
    provider: ProviderName;
    model: string;
    base_url: string | null;
    has_api_key: boolean;
}

export interface JwtPayload {
    /** The user id, as a string — the backend issues it as the standard JWT `sub` claim. */
    sub: string;
    email: string;
    exp: number;
    iat: number;
}

export interface AuthUser {
    id: number;
    email: string;
}

export interface UserSettings {
    preferences: Record<string, unknown>;
    has_claude_api_key: boolean;
    ai_provider?: AIProviderSettings | null;
}

export interface UserCommentaryHistory {
    commentaries: CommentaryHistoryItem[];
    total: number;
}

export interface TokenResponse {
    access: string;
    refresh: string;
    user: AuthUser;
}

export interface TokenRefreshResponse {
    access: string;
    refresh: string;
}
