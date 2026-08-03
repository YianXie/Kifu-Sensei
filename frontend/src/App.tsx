import { BrowserRouter, Route, Routes } from "react-router";

import ProtectedRoute from "@/components/global/ProtectedRoute";
import Layout from "@/components/layout/Layout";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Commentary from "@/pages/Commentary";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFoundPage";
import Privacy from "@/pages/Privacy";
import Register from "@/pages/Register";
import Settings from "@/pages/Settings";
import SetupApiKey from "@/pages/SetupApiKey";

import ExtensionReady from "./pages/ExtensionReady";
import History from "./pages/History";
import Logout from "./pages/Logout";

function ThemedApp() {
    const { userSettings } = useAuth();

    return (
        <ThemeProvider serverPreference={userSettings?.preferences?.theme}>
            <Routes>
                <Route element={<Layout />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/privacy" element={<Privacy />} />

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
