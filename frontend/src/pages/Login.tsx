import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";

import {
    Alert,
    Box,
    Button,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    TextField,
    Typography,
} from "@mui/material";

import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Login() {
    usePageTitle("Login");

    const { isAuthenticated, isLoading, user, login } = useAuth();
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [continueOpen, setContinueOpen] = useState(false);
    const [searchParams] = useSearchParams();
    const isForExtension = searchParams.get("source") === "extension";

    // Whether the one-click prompt has already had its say this visit. Once it
    // has, it must never reopen: logging in with another account flips
    // isAuthenticated back to true, which would otherwise re-trigger the prompt
    // on the way out.
    const promptSettled = useRef(false);
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isForExtension && isAuthenticated) {
            navigate("/");
            toast.warn("You are already logged in");
        }
    }, [isAuthenticated, navigate, isForExtension]);

    // Extension sign-in with a live website session: offer to reuse it instead
    // of making the user retype credentials. Waits for hydration to settle so
    // the form never flashes before the prompt.
    useEffect(() => {
        if (!isForExtension || isLoading || promptSettled.current) {
            return;
        }
        promptSettled.current = true;
        if (isAuthenticated) {
            setContinueOpen(true);
        }
    }, [isForExtension, isLoading, isAuthenticated]);

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

            {/* Dismissing this — "No", Escape, or a click outside — falls
                through to the form behind it, so a misclick costs nothing. */}
            <Dialog
                open={continueOpen}
                onClose={() => setContinueOpen(false)}
                fullWidth
                maxWidth="xs"
                // autoFocus on the button loses the race against the dialog's
                // focus trap, which lands focus on the paper instead. Focusing
                // once the transition has settled is what actually sticks, so
                // Enter confirms the highlighted action.
                slotProps={{
                    transition: {
                        onEntered: () => confirmRef.current?.focus(),
                    },
                }}
            >
                <DialogTitle>Use your current account?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        You&apos;re already signed in
                        {user?.email ? ` as ${user.email}` : ""}. Connect the
                        extension to this account, or sign in with a different
                        one.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        type="button"
                        onClick={() => setContinueOpen(false)}
                    >
                        No, use another account
                    </Button>
                    <Button
                        type="button"
                        variant="contained"
                        ref={confirmRef}
                        onClick={() =>
                            navigate("/extension-ready", { replace: true })
                        }
                    >
                        Yes, continue
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
