import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import {
    Alert,
    Box,
    Button,
    Container,
    Link as MuiLink,
    Stack,
    TextField,
    Typography,
} from "@mui/material";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { UserSettings } from "@/types/auth";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function SetupApiKey() {
    usePageTitle("Set Up Claude API Key");

    const navigate = useNavigate();
    const { updateUserSettings } = useAuth();

    const [apiKey, setApiKey] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

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

    function handleSkip() {
        navigate("/");
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
                <Box sx={{ textAlign: "center" }}>
                    <KeyOutlinedIcon
                        color="primary"
                        sx={{ fontSize: 48, mb: 1 }}
                    />
                    <Typography variant="h4" fontWeight={700}>
                        Add your Claude API key
                    </Typography>
                    <Typography color="text.secondary" mt={1}>
                        Kifu-Sensei uses Claude to write commentary on your
                        games. Your key is encrypted before it&apos;s stored and
                        is never shared.
                    </Typography>
                </Box>

                {error && <Alert severity="error">{error}</Alert>}

                <Box
                    component="form"
                    onSubmit={handleSave}
                    sx={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                    <TextField
                        label="Claude API Key"
                        type="password"
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        required
                        fullWidth
                        autoFocus
                        autoComplete="off"
                    />

                    <Stack direction="row" spacing={2}>
                        <Button
                            type="submit"
                            variant="contained"
                            size="large"
                            fullWidth
                            disabled={loading || !apiKey.trim()}
                        >
                            {loading ? "Saving…" : "Save Key"}
                        </Button>
                        <Button
                            type="button"
                            variant="outlined"
                            size="large"
                            fullWidth
                            onClick={handleSkip}
                            disabled={loading}
                        >
                            Skip for now
                        </Button>
                    </Stack>
                </Box>

                <Typography
                    textAlign="center"
                    variant="body2"
                    color="text.secondary"
                >
                    Don&apos;t have a key yet?{" "}
                    <MuiLink
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ color: "inherit", fontWeight: 600 }}
                    >
                        Get one from the Anthropic Console
                    </MuiLink>
                    .
                </Typography>
            </Box>
        </Container>
    );
}
