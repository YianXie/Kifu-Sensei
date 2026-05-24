import { useState } from "react";

import { Alert, Box, Button, Container, TextField, Typography } from "@mui/material";

import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useRedirectIfAuthenticated } from "@/hooks/useRedirectIfAuthenticated";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Register() {
    usePageTitle("Register");
    useRedirectIfAuthenticated();

    const navigate = useNavigate();

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
            toast.success("Account created! Please log in.");
            navigate("/login");
        } catch (err) {
            setError(getErrorMessage(err, "Registration failed."));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Container maxWidth="xs">
            <Box className="flex min-h-[80vh] flex-col justify-center gap-6">
                <Typography variant="h4" fontWeight={700} textAlign="center">
                    Create Account
                </Typography>

                {error && <Alert severity="error">{error}</Alert>}

                <Box component="form" onSubmit={handleSubmit} className="flex flex-col gap-4">
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

                <Typography textAlign="center" variant="body2" color="text.secondary">
                    Already have an account?{" "}
                    <Link to="/login" style={{ color: "inherit", fontWeight: 600 }}>
                        Log In
                    </Link>
                </Typography>
            </Box>
        </Container>
    );
}
