import { CommentaryResponse } from "./commentary";

export interface JwtPayload {
    user_id: number;
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
}

export interface UserCommentaryHistory {
    commentaries: CommentaryResponse[];
}

export interface TokenResponse {
    access: string;
    refresh: string;
    user: AuthUser;
}
