import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "react-toastify";

import { Alert, Button, Dialog, Divider, Field, Input } from "@/components/ui";
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
        <div className="ks-auth">
            <div className="ks-auth__head">
                <img src="/logo.png" width={56} height={56} alt="" />
                <h1 className="ks-auth__title">
                    Log in to Kifu-Sensei{isForExtension ? " Extension" : ""}
                </h1>
                <p className="ks-auth__lead">
                    Your reviews, your history, your own Claude API key.
                </p>
            </div>

            {error && <Alert severity="error">{error}</Alert>}

            <form onSubmit={handleSubmit} className="ks-auth__form">
                <Field label="Email" htmlFor="login-email">
                    <Input
                        id="login-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoFocus
                        autoComplete="email"
                    />
                </Field>
                <Field label="Password" htmlFor="login-password">
                    <Input
                        id="login-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                    />
                </Field>
                <Button type="submit" size="lg" block disabled={loading}>
                    {loading ? "Logging in…" : "Log in"}
                </Button>
            </form>

            <Divider label="or" />

            <div className="ks-auth__foot">
                <span>
                    Don&apos;t have an account?{" "}
                    <Link to="/register">Register</Link>
                </span>
                <span>
                    <Link to="/privacy">Privacy policy</Link>
                </span>
            </div>

            {/* Dismissing this — "No", Escape, or a click outside — falls
                through to the form behind it, so a misclick costs nothing. */}
            <Dialog
                open={continueOpen}
                size="sm"
                title="Use your current account?"
                onClose={() => setContinueOpen(false)}
                actions={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setContinueOpen(false)}
                        >
                            No, use another account
                        </Button>
                        <Button
                            onClick={() =>
                                navigate("/extension-ready", { replace: true })
                            }
                        >
                            Yes, continue
                        </Button>
                    </>
                }
            >
                You&apos;re already signed in
                {user?.email ? ` as ${user.email}` : ""}. Connect the extension
                to this account, or sign in with a different one.
            </Dialog>
        </div>
    );
}
