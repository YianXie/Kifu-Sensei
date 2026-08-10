import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import { looksLikeApiKey } from "@shared/commentary";

import api from "@/api";
import { Alert, Button, Field, Icon, Input } from "@/components/ui";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { UserSettings } from "@/types/auth";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function SetupApiKey() {
    usePageTitle("Set Up Claude API Key");

    const navigate = useNavigate();
    const { isLoading, userSettings, updateUserSettings } = useAuth();

    const [apiKey, setApiKey] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isLoading) return;
        if (userSettings?.has_claude_api_key) {
            toast.error("You have already set up a Claude API key.");
            navigate("/", { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, userSettings]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const { data } = await api.put<UserSettings>(
                ENDPOINTS.claudeApiKey,
                {
                    claude_api_key: apiKey.trim(),
                }
            );
            updateUserSettings(data);
            toast.success("Claude API key saved.");
            navigate("/");
        } catch (err) {
            setError(getErrorMessage(err, "Failed to save API key."));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="ks-auth">
            <div className="ks-auth__head">
                <Icon name="key" size="xl" />
                <h1 className="ks-auth__title">Add your Claude API key</h1>
                <p className="ks-auth__lead">
                    Kifu-Sensei uses Claude to write commentary on your games.
                    Your key is encrypted before it&apos;s stored and is never
                    shared.
                </p>
            </div>

            {error && <Alert severity="error">{error}</Alert>}

            <form onSubmit={handleSave} className="ks-auth__form">
                <Field
                    label="Claude API key"
                    htmlFor="setup-key"
                    // The panel has always shown this reassurance and the website
                    // showed none, so a mistyped key got a green tick in one place
                    // and silence in the other. The real check is still the backend
                    // accepting it — this only says "that looks like a key".
                    hint={
                        apiKey.trim() === ""
                            ? "Starts with sk-ant-"
                            : looksLikeApiKey(apiKey)
                              ? "That looks like a Claude API key."
                              : "Claude keys start with sk-ant- — check you pasted the whole thing."
                    }
                >
                    <Input
                        id="setup-key"
                        type="password"
                        mono
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        valid={apiKey.trim() !== "" && looksLikeApiKey(apiKey)}
                        required
                        autoFocus
                        autoComplete="off"
                    />
                </Field>
                <div style={{ display: "flex", gap: "var(--space-8)" }}>
                    <Button
                        type="submit"
                        size="lg"
                        block
                        disabled={loading || !apiKey.trim()}
                    >
                        {loading ? "Saving…" : "Save key"}
                    </Button>
                    <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        block
                        onClick={() => navigate("/")}
                        disabled={loading}
                    >
                        Skip for now
                    </Button>
                </div>
            </form>

            <p
                style={{
                    margin: 0,
                    textAlign: "center",
                    fontSize: "var(--text-2xs)",
                    color: "var(--text-muted)",
                }}
            >
                Don&apos;t have a key yet?{" "}
                <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Get one from the Anthropic Console
                </a>
                .
            </p>
        </div>
    );
}
