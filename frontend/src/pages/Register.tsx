import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "react-toastify";

import api from "@/api";
import { Alert, Button, Field, Input } from "@/components/ui";
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

    const mismatch = confirm.length > 0 && password !== confirm;

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
        <div className="ks-auth">
            <div className="ks-auth__head">
                <img src="/logo.png" width={56} height={56} alt="" />
                <h1 className="ks-auth__title">Create an account</h1>
                <p className="ks-auth__lead">
                    You&apos;ll add your own Claude API key next. It stays
                    encrypted.
                </p>
            </div>

            {error && <Alert severity="error">{error}</Alert>}

            <form onSubmit={handleSubmit} className="ks-auth__form">
                <Field label="Email" htmlFor="reg-email">
                    <Input
                        id="reg-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoFocus
                        autoComplete="email"
                    />
                </Field>
                <Field
                    label="Password"
                    htmlFor="reg-pw"
                    hint="At least 8 characters."
                >
                    <Input
                        id="reg-pw"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                        autoComplete="new-password"
                    />
                </Field>
                <Field
                    label="Confirm password"
                    htmlFor="reg-pw2"
                    error={mismatch ? "Passwords do not match." : undefined}
                >
                    <Input
                        id="reg-pw2"
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        invalid={mismatch}
                        autoComplete="new-password"
                    />
                </Field>
                <Button type="submit" size="lg" block disabled={loading}>
                    {loading ? "Creating account…" : "Register"}
                </Button>
            </form>

            <div className="ks-auth__foot">
                <span>
                    Already have an account? <Link to="/login">Log in</Link>
                </span>
                <span>
                    <Link to="/privacy">Privacy policy</Link>
                </span>
            </div>
        </div>
    );
}
