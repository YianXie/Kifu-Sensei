export interface JwtPayload {
    user_id: number;
    email: string;
    exp: number;
    iat: number;
}

export interface AuthUser {
    id: number;
    email: string;
    preferences: Record<string, unknown>;
}

export interface UserSettings {
    preferences: Record<string, unknown>;
}

export interface TokenResponse {
    access: string;
    refresh: string;
    user: AuthUser;
}
