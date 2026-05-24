import { useMemo } from "react";

import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from "@mui/material";

import { BrowserRouter, Route, Routes } from "react-router-dom";

import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/contexts/AuthContext";
import Dashboard from "@/pages/Dashboard";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Profile from "@/pages/Profile";
import Register from "@/pages/Register";
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
        [prefersDark],
    );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <AuthProvider>
                    <Routes>
                        <Route element={<Layout />}>
                            <Route path="/" element={<Home />} />
                            <Route path="/login" element={<Login />} />
                            <Route path="/register" element={<Register />} />

                            <Route element={<ProtectedRoute />}>
                                <Route path="/dashboard" element={<Dashboard />} />
                                <Route path="/settings" element={<Settings />} />
                                <Route path="/profile" element={<Profile />} />
                            </Route>
                        </Route>
                    </Routes>
                </AuthProvider>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default ThemedApp;
