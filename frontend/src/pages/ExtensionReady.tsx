import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import {
    Box,
    Button,
    CircularProgress,
    Container,
    Typography,
} from "@mui/material";

import axios from "axios";

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
        <Container maxWidth="sm">
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 3,
                    textAlign: "center",
                }}
            >
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                    }}
                >
                    <img
                        src="/logo.png"
                        alt="Kifu-Sensei"
                        style={{
                            maxWidth: "100px",
                            height: "auto",
                            userSelect: "none",
                        }}
                        draggable={false}
                    />
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        Kifu-Sensei
                    </Typography>
                </Box>

                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                    }}
                >
                    {state === "working" && (
                        <>
                            <CircularProgress size={60} />
                            <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                Connecting your extension…
                            </Typography>
                        </>
                    )}

                    {state === "done" && (
                        <>
                            <CheckCircleIcon
                                sx={{
                                    fontSize: 60,
                                    color: "success.main",
                                }}
                            />
                            <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                Extension Authenticated
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                Your extension is now logged in and ready to
                                use.
                            </Typography>
                        </>
                    )}

                    {state === "failed" && (
                        <>
                            <ErrorOutlineIcon
                                sx={{ fontSize: 60, color: "error.main" }}
                            />
                            <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                Could not connect your extension
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                We couldn&apos;t reach Kifu-Sensei to finish
                                signing the extension in. Check your connection
                                and try again.
                            </Typography>
                            <Button
                                variant="contained"
                                onClick={() =>
                                    refreshToken && void handOff(refreshToken)
                                }
                            >
                                Try again
                            </Button>
                        </>
                    )}
                </Box>
            </Box>
        </Container>
    );
}
