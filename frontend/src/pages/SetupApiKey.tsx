import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import type { ProviderName } from "@shared/types";

import api from "@/api";
import { Alert, Button, Field, Icon, Input, Select } from "@/components/ui";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { AIProviderSettings, UserSettings } from "@/types/auth";
import { getErrorMessage } from "@/utils/errorFormatting";

const DEFAULT_MODELS: Record<ProviderName, string> = {
    claude: "claude-sonnet-5",
    "openai-compatible": "",
};

function mergeProviderSettings(
    current: UserSettings | null,
    provider: AIProviderSettings | null
): UserSettings {
    return {
        preferences: current?.preferences ?? {},
        has_claude_api_key:
            provider?.provider === "claude" && provider.has_api_key,
        ai_provider: provider,
    };
}

export default function SetupApiKey() {
    usePageTitle("Set Up AI Provider");

    const navigate = useNavigate();
    const { isLoading, userSettings, updateUserSettings } = useAuth();
    const [provider, setProvider] = useState<ProviderName>("claude");
    const [model, setModel] = useState(DEFAULT_MODELS.claude);
    const [apiKey, setApiKey] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isLoading) return;
        if (userSettings?.ai_provider || userSettings?.has_claude_api_key) {
            toast.error("You have already configured an AI provider.");
            navigate("/", { replace: true });
        }
    }, [isLoading, navigate, userSettings]);

    const requiresKey = provider === "claude";

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const { data } = await api.put<AIProviderSettings>(
                ENDPOINTS.aiProvider,
                {
                    provider,
                    model: model.trim(),
                    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
                    ...(provider === "openai-compatible" && baseUrl.trim()
                        ? { base_url: baseUrl.trim() }
                        : {}),
                }
            );
            updateUserSettings(mergeProviderSettings(userSettings, data));
            toast.success("AI provider saved.");
            navigate("/");
        } catch (err) {
            setError(getErrorMessage(err, "Failed to save AI provider."));
        } finally {
            setLoading(false);
        }
    }

    function changeProvider(next: ProviderName) {
        setProvider(next);
        setModel(DEFAULT_MODELS[next]);
        setApiKey("");
        setBaseUrl("");
    }

    return (
        <div className="ks-auth">
            <div className="ks-auth__head">
                <Icon name="key" size="xl" />
                <h1 className="ks-auth__title">Configure your AI provider</h1>
                <p className="ks-auth__lead">
                    Kifu-Sensei uses your selected provider to write commentary
                    on your games. Credentials are encrypted before storage and
                    are never shared with other users.
                </p>
            </div>

            {error && <Alert severity="error">{error}</Alert>}

            <form onSubmit={handleSave} className="ks-auth__form">
                <Field label="Provider" htmlFor="setup-provider">
                    <Select
                        id="setup-provider"
                        value={provider}
                        onChange={(e) =>
                            changeProvider(e.target.value as ProviderName)
                        }
                        options={[
                            { value: "claude", label: "Claude (Anthropic)" },
                            {
                                value: "openai-compatible",
                                label: "OpenAI-compatible endpoint",
                            },
                        ]}
                    />
                </Field>

                <Field
                    label="Model"
                    htmlFor="setup-model"
                    hint="Enter the model ID supported by this provider."
                >
                    <Input
                        id="setup-model"
                        type="text"
                        mono
                        placeholder={
                            provider === "claude"
                                ? "claude-sonnet-5"
                                : "llama3.1 or gpt-4o"
                        }
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        required
                        autoFocus
                        autoComplete="off"
                    />
                </Field>

                {provider === "openai-compatible" && (
                    <Field
                        label="Base URL (optional)"
                        htmlFor="setup-base-url"
                        hint="Leave blank for api.openai.com. Use this for vLLM or Ollama-compatible servers."
                    >
                        <Input
                            id="setup-base-url"
                            type="url"
                            mono
                            placeholder="https://api.openai.com/v1"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            autoComplete="off"
                        />
                    </Field>
                )}

                <Field
                    label={requiresKey ? "API key" : "API key (optional)"}
                    htmlFor="setup-key"
                    hint={
                        requiresKey
                            ? "Your Claude key is encrypted before storage."
                            : "Local endpoints may accept an arbitrary credential or no key."
                    }
                >
                    <Input
                        id="setup-key"
                        type="password"
                        mono
                        placeholder={requiresKey ? "sk-ant-..." : "Optional"}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        required={requiresKey}
                        autoComplete="off"
                    />
                </Field>

                <div style={{ display: "flex", gap: "var(--space-8)" }}>
                    <Button
                        type="submit"
                        size="lg"
                        block
                        disabled={
                            loading || !model.trim() || (requiresKey && !apiKey.trim())
                        }
                    >
                        {loading ? "Saving…" : "Save provider"}
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
        </div>
    );
}
