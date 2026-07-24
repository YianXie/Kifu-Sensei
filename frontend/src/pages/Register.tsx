import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Register() {
    usePageTitle("Register");

    const { login, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const source = searchParams.get("source");

    useEffect(() => {
        if (!source || source !== "extension") {
            if (isAuthenticated) {
                navigate("/");
                toast.warn("You are already logged in!");
            }
        }
    });

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        const normalizedEmail = email.trim().toLowerCase();

        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        try {
            await api.post(ENDPOINTS.register, {
                email: normalizedEmail,
                password,
            });
            // Log the new user in so they can immediately set up their API key.
            await login(normalizedEmail, password);
            toast.success("Account created!");
            navigate(
                source === "extension" ? "/extension-ready" : "/setup-api-key",
                { replace: true }
            );
        } catch (err) {
            setError(getErrorMessage(err, "Registration failed."));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Container maxWidth="sm">
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 3,
                    minHeight: "80vh",
                }}
            >
                <Typography
                    variant="h4"
                    sx={{ fontWeight: 700, textAlign: "center" }}
                >
                    Create an Account
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
                        slotProps={{ htmlInput: { minLength: 8 } }}
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
                    variant="body2"
                    color="text.secondary"
                    sx={{ textAlign: "center" }}
                >
                    Already have an account?{" "}
                    <Link
                        to="/login"
                        style={{ color: "inherit", fontWeight: 600 }}
                    >
                        Log In
                    </Link>
                </Typography>

                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ textAlign: "center" }}
                >
                    <Link
                        to="/privacy"
                        style={{ color: "inherit", fontWeight: 600 }}
                    >
                        Privacy Policy
                    </Link>
                </Typography>
            </Box>
        </Container>
    );
}
