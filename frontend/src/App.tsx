import { useMemo } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import {
    CssBaseline,
    ThemeProvider,
    createTheme,
    useMediaQuery,
} from "@mui/material";

import ProtectedRoute from "@/components/global/ProtectedRoute";
import Layout from "@/components/layout/Layout";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Commentary from "@/pages/Commentary";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFoundPage";
import Register from "@/pages/Register";
import Settings from "@/pages/Settings";
import SetupApiKey from "@/pages/SetupApiKey";

import ExtensionReady from "./pages/ExtensionReady";
import History from "./pages/History";
import Logout from "./pages/Logout";

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
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />

                    <Route element={<ProtectedRoute />}>
                        <Route path="/commentary" element={<Commentary />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/history" element={<History />} />
                        <Route
                            path="/setup-api-key"
                            element={<SetupApiKey />}
                        />
                        <Route path="/logout" element={<Logout />} />
                        <Route
                            path="/extension-ready"
                            element={<ExtensionReady />}
                        />
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
