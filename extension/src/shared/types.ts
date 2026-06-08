// src/shared/types.ts
export const AuthStates = {
    UNAUTHENTICATED: "UNAUTHENTICATED",
    AUTH_NO_KEY: "AUTH_NO_KEY",
    READY: "READY",
} as const;

export type AuthState = (typeof AuthStates)[keyof typeof AuthStates];
