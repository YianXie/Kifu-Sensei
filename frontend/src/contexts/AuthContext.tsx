import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

import axios from "axios";
import { jwtDecode } from "jwt-decode";

import api from "@/api";
import { ENDPOINTS } from "@/constants/global/endpoints";
import {
    AuthUser,
    JwtPayload,
    TokenResponse,
    UserSettings,
} from "@/types/auth";

interface AuthContextValue {
    accessToken: string | null;
    refreshToken: string | null;
    user: AuthUser | null;
    userSettings: UserSettings | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
    updateUserSettings: (settings: UserSettings) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [accessToken, setAccessToken] = useState<string | null>(
        localStorage.getItem("access_token")
    );
    const [refreshToken, setRefreshToken] = useState<string | null>(
        localStorage.getItem("refresh_token")
    );
    const [user, setUser] = useState<AuthUser | null>(null);
    const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const logout = useCallback(() => {
        const token = localStorage.getItem("access_token");
        if (token) {
            // Best-effort server-side revocation (bumps the account's token_version,
            // invalidating every outstanding access/refresh token, not just this
            // one) — not awaited, since logging out must not hang on the network,
            // and there is nothing more to do locally either way. The header is
            // passed explicitly rather than left to the request interceptor, since
            // the token is about to be removed from localStorage below and the
            // interceptor reads it at request time.
            void api
                .post(
                    ENDPOINTS.logout,
                    {},
                    { headers: { Authorization: `Bearer ${token}` } }
                )
                .catch(() => {});
        }
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        // Revoke the extension handoff too, so logging out of the website
        // doesn't leave a stale session the extension can silently pick up.
        localStorage.removeItem("extension_auth");
        setAccessToken(null);
        setRefreshToken(null);
        setUser(null);
        setUserSettings(null);
    }, []);

    // Hydrate user state from stored tokens on mount
    useEffect(() => {
        async function hydrate() {
            const stored = localStorage.getItem("access_token");
            if (!stored) {
                setIsLoading(false);
                return;
            }
            try {
                const decoded = jwtDecode<JwtPayload>(stored);
                if (decoded.exp * 1000 < Date.now()) {
                    logout();
                    return;
                }
                setUser({
                    id: Number(decoded.sub),
                    email: decoded.email,
                });
                try {
                    const { data } = await api.get<UserSettings>(
                        ENDPOINTS.userSettings
                    );
                    setUserSettings(data);
                } catch (error) {
                    // The token decoded fine and is not expired, so only a genuine
                    // 401 (e.g. revoked server-side) means the session is dead. Any
                    // other failure — offline, a 500, a timeout — is transient: keep
                    // the session so the user isn't bounced to the login page for a
                    // problem that isn't theirs to fix.
                    if (
                        axios.isAxiosError(error) &&
                        error.response?.status === 401
                    ) {
                        logout();
                    }
                }
            } catch {
                logout();
            } finally {
                setIsLoading(false);
            }
        }
        hydrate();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const login = useCallback(async (email: string, password: string) => {
        const { data } = await api.post<TokenResponse>(ENDPOINTS.tokenObtain, {
            email,
            password,
        });
        localStorage.setItem("access_token", data.access);
        localStorage.setItem("refresh_token", data.refresh);
        setAccessToken(data.access);
        setRefreshToken(data.refresh);
        setUser(data.user);

        const { data: settings } = await api.get<UserSettings>(
            ENDPOINTS.userSettings
        );
        setUserSettings(settings);
    }, []);

    const updateUserSettings = useCallback((settings: UserSettings) => {
        setUserSettings(settings);
    }, []);

    return (
        <AuthContext.Provider
            value={{
                accessToken,
                refreshToken,
                user,
                userSettings,
                isAuthenticated: !!accessToken && !!user,
                isLoading,
                login,
                logout,
                updateUserSettings,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}
