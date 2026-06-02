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
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import About from "@/pages/About";
import Commentary from "@/pages/Commentary";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFoundPage";
import Register from "@/pages/Register";
import Settings from "@/pages/Settings";
import SetupApiKey from "@/pages/SetupApiKey";

function ThemedApp() {
    const { userSettings } = useAuth();
    const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
    const preferredTheme = userSettings?.preferences?.theme;
    const themeModePreference =
        preferredTheme === "light" ||
        preferredTheme === "dark" ||
        preferredTheme === "system"
            ? preferredTheme
            : "system";
    const resolvedMode =
        themeModePreference === "system"
            ? prefersDark
                ? "dark"
                : "light"
            : themeModePreference;

    const theme = useMemo(
        () =>
            createTheme({
                palette: {
                    mode: resolvedMode,
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
        [resolvedMode]
    );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Routes>
                <Route element={<Layout />}>
                    <Route path="/about" element={<About />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />

                    <Route element={<ProtectedRoute />}>
                        <Route path="/settings" element={<Settings />} />
                        <Route
                            path="/setup-api-key"
                            element={<SetupApiKey />}
                        />
                        <Route path="/" element={<Commentary />} />
                    </Route>

                    <Route path="*" element={<NotFound />} />
                </Route>
            </Routes>
        </ThemeProvider>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <ThemedApp />
            </AuthProvider>
        </BrowserRouter>
    );
}
