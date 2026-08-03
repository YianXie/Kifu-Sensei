import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import axios from "axios";

import { Button, Icon, Spinner } from "@/components/ui";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { TokenRefreshResponse } from "@/types/auth";

type HandoffState = "working" | "done" | "failed";

export default function ExtensionReady() {
    usePageTitle("Extension Ready");

    const { isAuthenticated, isLoading, refreshToken, logout } = useAuth();
    const navigate = useNavigate();
    const [state, setState] = useState<HandoffState>("working");
    // Effects run twice under StrictMode; one handoff is enough.
    const started = useRef(false);

    // Hand the extension its own freshly minted token pair rather than a copy
    // of the website's. Signing out of the panel marks the refresh token it was
    // holding as revoked, and the content script refuses to re-adopt that exact
    // token — so passing the website's unchanged pair would be silently ignored
    // for anyone who signed out of the panel but stayed signed in here. The
    // backend doesn't invalidate the old pair, so this session stays valid too.
    const handOff = useCallback(async (refresh: string) => {
        setState("working");
        try {
            const { data } = await axios.post<TokenRefreshResponse>(
                ENDPOINTS.tokenRefresh,
                { refresh }
            );
            localStorage.setItem(
                "extension_auth",
                JSON.stringify({
                    accessToken: data.access,
                    refreshToken: data.refresh,
                })
            );
            setState("done");
        } catch {
            setState("failed");
        }
    }, []);

    useEffect(() => {
        if (isLoading || started.current) {
            return;
        }
        if (!isAuthenticated || !refreshToken) {
            started.current = true;
            logout();
            navigate("/login?source=extension", { replace: true });
            toast.error("You are not logged in");
            return;
        }
        started.current = true;
        void handOff(refreshToken);
    }, [isAuthenticated, isLoading, refreshToken, logout, navigate, handOff]);

    return (
        <div
            className="ks-auth"
            style={{ alignItems: "center", textAlign: "center" }}
        >
            <img
                src="/logo.png"
                width={72}
                height={72}
                alt=""
                draggable={false}
            />
            <h1 className="ks-auth__title">Kifu-Sensei</h1>

            {state === "working" && (
                <div className="ks-center" style={{ gap: "var(--space-9)" }}>
                    <Spinner size={48} />
                    <p
                        style={{
                            margin: 0,
                            fontSize: "var(--text-md)",
                            color: "var(--text-secondary)",
                        }}
                    >
                        Connecting your extension…
                    </p>
                </div>
            )}

            {state === "done" && (
                <div className="ks-center" style={{ gap: "var(--space-8)" }}>
                    <span
                        style={{
                            color: "var(--success)",
                            display: "inline-flex",
                        }}
                    >
                        <Icon name="check_circle" size="xl" />
                    </span>
                    <h2 className="ks-heading" style={{ margin: 0 }}>
                        Extension authenticated
                    </h2>
                    <p className="ks-auth__lead">
                        Your extension is signed in and ready to use. You can
                        close this tab.
                    </p>
                </div>
            )}

            {state === "failed" && (
                <div className="ks-center" style={{ gap: "var(--space-8)" }}>
                    <span
                        style={{
                            color: "var(--danger)",
                            display: "inline-flex",
                        }}
                    >
                        <Icon name="error" size="xl" />
                    </span>
                    <h2 className="ks-heading" style={{ margin: 0 }}>
                        Could not connect your extension
                    </h2>
                    <p className="ks-auth__lead">
                        Kifu-Sensei could not be reached to finish signing the
                        extension in. Check your connection and try again.
                    </p>
                    <Button
                        onClick={() =>
                            refreshToken && void handOff(refreshToken)
                        }
                    >
                        Try again
                    </Button>
                </div>
            )}
        </div>
    );
}
