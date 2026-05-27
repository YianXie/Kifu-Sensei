import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import {
    Alert,
    Box,
    Button,
    Container,
    TextField,
    Typography,
} from "@mui/material";

import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Login() {
    usePageTitle("Log In");
    useRedirectIfAuthenticated();

    const { login } = useAuth();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email, password);
            toast.success("Welcome back!");
            navigate("/");
        } catch (err) {
            setError(
                getErrorMessage(err, "Login failed. Check your credentials.")
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <Container maxWidth="xs">
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 3,
                    minHeight: "80vh",
                }}
            >
                <Typography variant="h4" fontWeight={700} textAlign="center">
                    Log In
                </Typography>

                {error && <Alert severity="error">{error}</Alert>}

                <Box
                    component="form"
                    onSubmit={handleSubmit}
                    sx={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                    <TextField
                        label="Email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        fullWidth
                        autoFocus
                        autoComplete="email"
                    />
                    <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        fullWidth
                        autoComplete="current-password"
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        fullWidth
                        disabled={loading}
                    >
                        {loading ? "Logging in…" : "Log In"}
                    </Button>
                </Box>

                <Typography
                    textAlign="center"
                    variant="body2"
                    color="text.secondary"
                >
                    Don&apos;t have an account?{" "}
                    <Link
                        to="/register"
                        style={{ color: "inherit", fontWeight: 600 }}
                    >
                        Register
                    </Link>
                </Typography>
            </Box>
        </Container>
    );
}
