import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

import { jwtDecode } from "jwt-decode";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
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
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
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
                    id: decoded.user_id,
                    email: decoded.email,
                });
                const { data } = await api.get<UserSettings>(
                    ENDPOINTS.userSettings
                );
                setUserSettings(data);
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
