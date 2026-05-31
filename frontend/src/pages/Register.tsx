import { useEffect, useRef, useState } from "react";
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

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Register() {
    usePageTitle("Register");

    const { login, isAuthenticated } = useAuth();
    const navigate = useNavigate();

    // Only bounce visitors who were *already* logged in when they arrived; the
    // registration flow itself logs the user in and routes them to API-key setup.
    const wasAuthenticatedOnMount = useRef(isAuthenticated);
    useEffect(() => {
        if (wasAuthenticatedOnMount.current) {
            navigate("/", { replace: true });
        }
    }, [navigate]);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        try {
            await api.post(ENDPOINTS.register, { email, password });
            // Log the new user in so they can immediately set up their API key.
            await login(email, password);
            toast.success("Account created!");
            navigate("/setup-api-key", { replace: true });
        } catch (err) {
            setError(getErrorMessage(err, "Registration failed."));
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
                    Create Account
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
                        inputProps={{ minLength: 8 }}
                        autoComplete="new-password"
                    />
                    <TextField
                        label="Confirm Password"
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        fullWidth
                        autoComplete="new-password"
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        fullWidth
                        disabled={loading}
                    >
                        {loading ? "Creating account…" : "Register"}
                    </Button>
                </Box>

                <Typography
                    textAlign="center"
                    variant="body2"
                    color="text.secondary"
                >
                    Already have an account?{" "}
                    <Link
                        to="/login"
                        style={{ color: "inherit", fontWeight: 600 }}
                    >
                        Log In
                    </Link>
                </Typography>
            </Box>
        </Container>
    );
}
