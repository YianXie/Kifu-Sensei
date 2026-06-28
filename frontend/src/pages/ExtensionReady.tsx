import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { Box, Container, Typography } from "@mui/material";

import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function ExtensionReady() {
    usePageTitle("Extension Ready");

    const { isAuthenticated, accessToken, refreshToken, logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!isAuthenticated) {
            navigate("/login");
            toast.error("You are not logged in");
        }
        if (!accessToken || !refreshToken) {
            logout();
            navigate("/login");
            toast.error("You are not logged in");
        }

        const extensionAuth = {
            accessToken,
            refreshToken,
        };
        localStorage.setItem("extension_auth", JSON.stringify(extensionAuth));
    }, [accessToken, isAuthenticated, logout, navigate, refreshToken]);

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
                        Your extension is now logged in and ready to use.
                    </Typography>
                </Box>
            </Box>
        </Container>
    );
}
