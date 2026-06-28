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

import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Login() {
    usePageTitle("Login");

    const { isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [searchParams] = useSearchParams();
    const isForExtension = searchParams.get("source") === "extension";

    useEffect(() => {
        if (!isForExtension && isAuthenticated) {
            navigate("/");
            toast.warn("You are already logged in");
        }
    }, [isAuthenticated, navigate, isForExtension]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email, password);
            toast.success("Welcome back!");
            navigate(isForExtension ? "/extension-ready" : "/", {
                replace: true,
            });
        } catch (err) {
            setError(
                getErrorMessage(err, "Login failed. Check your credentials.")
            );
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
                    Log In to Kifu-Sensei {isForExtension && "Extension"}
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
                    variant="body2"
                    color="text.secondary"
                    sx={{ textAlign: "center" }}
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
