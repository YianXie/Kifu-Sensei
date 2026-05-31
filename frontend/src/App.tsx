import { useMemo } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import {
    CssBaseline,
    ThemeProvider,
    createTheme,
    useMediaQuery,
} from "@mui/material";

import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/contexts/AuthContext";
import Commentary from "@/pages/Commentary";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFoundPage";
import Register from "@/pages/Register";
import SetupApiKey from "@/pages/SetupApiKey";
import Settings from "@/pages/Settings";

function ThemedApp() {
    const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
    const theme = useMemo(
        () =>
            createTheme({
                palette: {
                    mode: prefersDark ? "dark" : "light",
                },
                typography: {
                    fontFamily: [
                        "Inter",
                        "-apple-system",
                        "BlinkMacSystemFont",
                        "Segoe UI",
                        "sans-serif",
                    ].join(","),
                },
            }),
        [prefersDark]
    );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <AuthProvider>
                    <Routes>
                        <Route element={<Layout />}>
                            <Route path="/home" element={<Home />} />
                            <Route path="/login" element={<Login />} />
                            <Route path="/register" element={<Register />} />

                            <Route element={<ProtectedRoute />}>
                                <Route
                                    path="/settings"
                                    element={<Settings />}
                                />
                                <Route
                                    path="/setup-api-key"
                                    element={<SetupApiKey />}
                                />
                                <Route path="/" element={<Commentary />} />
                            </Route>

                            <Route path="*" element={<NotFound />} />
                        </Route>
                    </Routes>
                </AuthProvider>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default ThemedApp;
