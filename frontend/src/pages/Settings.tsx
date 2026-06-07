import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    MenuItem,
    Select,
    Tab,
    Tabs,
    TextField,
    Typography,
} from "@mui/material";

import api from "@/api";
import CommentaryConfig from "@/components/commentary/CommentaryConfig";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { UserSettings } from "@/types/auth";
import {
    type ClaudeModel,
    CommentaryLanguage,
    readCommentaryConfig,
} from "@/types/commentary";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Settings() {
    usePageTitle("Settings");

    const { user, userSettings, updateUserSettings, logout } = useAuth();

    const prefs = userSettings?.preferences ?? {};

    const [tab, setTab] = useState(0);

    const [newEmail, setNewEmail] = useState("");
    const [emailPassword, setEmailPassword] = useState("");
    const [emailError, setEmailError] = useState<string | null>(null);
    const [emailLoading, setEmailLoading] = useState(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordLoading, setPasswordLoading] = useState(false);

    const [deletePassword, setDeletePassword] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);

    const savedConfig = readCommentaryConfig(prefs);
    const [model, setModel] = useState<ClaudeModel>(savedConfig.model);
    const [language, setLanguage] = useState<CommentaryLanguage>(
        savedConfig.language
    );
    const [numComments, setNumComments] = useState<number>(
        savedConfig.num_comments
    );
    const [maxToken, setMaxToken] = useState<number>(savedConfig.max_token);
    const [customInstruction, setCustomInstruction] = useState<string>(
        savedConfig.custom_instruction
    );
    const [configError, setConfigError] = useState<string | null>(null);
    const [configLoading, setConfigLoading] = useState(false);

    const [theme, setTheme] = useState<string>(
        (prefs.theme as string) ?? "system"
    );
    const [themeError, setThemeError] = useState<string | null>(null);
    const [themeLoading, setThemeLoading] = useState(false);

    const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [apiKeyLoading, setApiKeyLoading] = useState(false);
    const hasClaudeApiKey = userSettings?.has_claude_api_key ?? false;

    useEffect(() => {
        const nextTheme =
            prefs.theme === "light" ||
            prefs.theme === "dark" ||
            prefs.theme === "system"
                ? prefs.theme
                : "system";
        setTheme(nextTheme);
    }, [prefs.theme]);

    async function handleUpdateTheme() {
        setThemeLoading(true);
        setThemeError(null);
        try {
            const { data } = await api.put<UserSettings>(
                ENDPOINTS.userSettings,
                {
                    preferences: { theme },
                }
            );
            updateUserSettings(data);
            toast.success("Settings saved.");
        } catch (err) {
            setThemeError(getErrorMessage(err, "Failed to save settings."));
        } finally {
            setThemeLoading(false);
        }
    }

    async function handleSaveCommentaryConfig() {
        setConfigLoading(true);
        setConfigError(null);
        try {
            const { data } = await api.put<UserSettings>(
                ENDPOINTS.userSettings,
                {
                    preferences: {
                        commentary_config: {
                            model,
                            num_comments: numComments,
                            max_token: maxToken,
                            custom_instruction: customInstruction,
                        },
                    },
                }
            );
            updateUserSettings(data);
            toast.success("Default commentary config saved.");
        } catch (err) {
            setConfigError(
                getErrorMessage(err, "Failed to save commentary config.")
            );
        } finally {
            setConfigLoading(false);
        }
    }

    async function handleSaveApiKey(e: React.FormEvent) {
        e.preventDefault();
        setApiKeyError(null);
        setApiKeyLoading(true);
        try {
            const { data } = await api.put<UserSettings>(
                ENDPOINTS.claudeApiKey,
                { claude_api_key: apiKey.trim() }
            );
            updateUserSettings(data);
            toast.success("Claude API key saved.");
            setApiKey("");
            setApiKeyDialogOpen(false);
        } catch (err) {
            setApiKeyError(getErrorMessage(err, "Failed to save API key."));
        } finally {
            setApiKeyLoading(false);
        }
    }

    function closeApiKeyDialog() {
        if (apiKeyLoading) return;
        setApiKeyDialogOpen(false);
        setApiKey("");
        setApiKeyError(null);
    }

    async function handleUpdateEmail(e: React.FormEvent) {
        e.preventDefault();
        setEmailError(null);
        setEmailLoading(true);
        try {
            await api.post(ENDPOINTS.updateEmail, {
                email: newEmail,
                password: emailPassword,
            });
            toast.success("Email updated. Please log in again.");
            logout();
        } catch (err) {
            setEmailError(getErrorMessage(err, "Failed to update email."));
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleUpdatePassword(e: React.FormEvent) {
        e.preventDefault();
        setPasswordError(null);
        if (newPassword !== confirmPassword) {
            setPasswordError("New passwords do not match.");
            return;
        }
        setPasswordLoading(true);
        try {
            await api.post(ENDPOINTS.updatePassword, {
                current_password: currentPassword,
                new_password: newPassword,
            });
            toast.success("Password updated.");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err) {
            setPasswordError(
                getErrorMessage(err, "Failed to update password.")
            );
        } finally {
            setPasswordLoading(false);
        }
    }

    async function handleDeleteAccount() {
        if (
            !window.confirm(
                "This will permanently delete your account. Are you sure?"
            )
        )
            return;
        setDeleteError(null);
        setDeleteLoading(true);
        try {
            await api.delete(ENDPOINTS.deleteAccount, {
                data: { password: deletePassword },
            });
            logout();
        } catch (err) {
            setDeleteError(getErrorMessage(err, "Failed to delete account."));
        } finally {
            setDeleteLoading(false);
        }
    }

    return (
        <Box sx={{ maxWidth: 560 }}>
            <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
                Settings
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
                {user?.email}
            </Typography>

            <Tabs
                value={tab}
                onChange={(_, value) => setTab(value)}
                sx={{ mb: 4, borderBottom: 1, borderColor: "divider" }}
            >
                <Tab label="Account" />
                <Tab label="Default Commentary Config" />
                <Tab label="Miscellaneous" />
            </Tabs>

            {/* Account */}
            {tab === 0 && (
                <Box>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                        Update Email
                    </Typography>
                    {emailError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {emailError}
                        </Alert>
                    )}
                    <Box
                        component="form"
                        onSubmit={handleUpdateEmail}
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 1.5,
                            mb: 3,
                        }}
                    >
                        <TextField
                            label="New Email"
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            required
                            fullWidth
                        />
                        <TextField
                            label="Current Password"
                            type="password"
                            value={emailPassword}
                            onChange={(e) => setEmailPassword(e.target.value)}
                            required
                            fullWidth
                        />
                        <Button
                            type="submit"
                            variant="outlined"
                            disabled={emailLoading}
                        >
                            {emailLoading ? "Updating…" : "Update Email"}
                        </Button>
                    </Box>

                    <Divider sx={{ my: 4 }} />

                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                        Update Password
                    </Typography>
                    {passwordError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {passwordError}
                        </Alert>
                    )}
                    <Box
                        component="form"
                        onSubmit={handleUpdatePassword}
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 1.5,
                            mb: 3,
                        }}
                    >
                        <TextField
                            label="Current Password"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                            fullWidth
                        />
                        <TextField
                            label="New Password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            fullWidth
                            slotProps={{ htmlInput: { minLength: 8 } }}
                        />
                        <TextField
                            label="Confirm New Password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            fullWidth
                        />
                        <Button
                            type="submit"
                            variant="outlined"
                            disabled={passwordLoading}
                        >
                            {passwordLoading ? "Updating…" : "Update Password"}
                        </Button>
                    </Box>

                    <Divider sx={{ my: 4 }} />

                    <Typography
                        variant="h6"
                        color="error"
                        sx={{ mb: 2, fontWeight: 600 }}
                    >
                        Danger Zone
                    </Typography>
                    {deleteError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {deleteError}
                        </Alert>
                    )}
                    <TextField
                        label="Confirm Password to Delete"
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        fullWidth
                        sx={{ mb: 2 }}
                    />
                    <Button
                        variant="outlined"
                        color="error"
                        onClick={handleDeleteAccount}
                        disabled={deleteLoading || !deletePassword}
                    >
                        {deleteLoading ? "Deleting…" : "Delete Account"}
                    </Button>
                </Box>
            )}

            {/* Default Commentary Config */}
            {tab === 1 && (
                <Box>
                    <Typography color="text.secondary" sx={{ mb: 2 }}>
                        These values are used as the defaults on the Commentary
                        page.
                    </Typography>
                    {configError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {configError}
                        </Alert>
                    )}
                    <CommentaryConfig
                        model={model}
                        setModel={setModel}
                        language={language}
                        setLanguage={setLanguage}
                        numComments={numComments}
                        setNumComments={setNumComments}
                        maxToken={maxToken}
                        setMaxToken={setMaxToken}
                        customInstruction={customInstruction}
                        setCustomInstruction={setCustomInstruction}
                    />
                    <Button
                        variant="outlined"
                        onClick={handleSaveCommentaryConfig}
                        disabled={configLoading}
                        sx={{ mt: 2 }}
                    >
                        {configLoading ? "Saving…" : "Save Defaults"}
                    </Button>
                </Box>
            )}

            {/* Miscellaneous */}
            {tab === 2 && (
                <Box>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                        Theme
                    </Typography>
                    {themeError && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {themeError}
                        </Alert>
                    )}
                    <Box
                        component="form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleUpdateTheme();
                        }}
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 1.5,
                            mb: 4,
                        }}
                    >
                        <Select
                            value={theme}
                            onChange={(e) => setTheme(e.target.value)}
                            fullWidth
                        >
                            <MenuItem value="system">System</MenuItem>
                            <MenuItem value="light">Light</MenuItem>
                            <MenuItem value="dark">Dark</MenuItem>
                        </Select>
                        <Button
                            type="submit"
                            variant="outlined"
                            disabled={themeLoading}
                        >
                            {themeLoading ? "Updating…" : "Update Theme"}
                        </Button>
                    </Box>

                    <Divider sx={{ my: 4 }} />

                    <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                        Claude API Key
                    </Typography>
                    <Typography color="text.secondary" sx={{ mb: 2 }}>
                        {hasClaudeApiKey
                            ? "A Claude API key is set. You can update it with a new key at any time."
                            : "No Claude API key is set yet. Add one to start generating commentary."}
                    </Typography>
                    <Button
                        variant="outlined"
                        onClick={() => setApiKeyDialogOpen(true)}
                    >
                        {hasClaudeApiKey
                            ? "Update Claude API Key"
                            : "Add Claude API Key"}
                    </Button>
                </Box>
            )}

            <Dialog
                open={apiKeyDialogOpen}
                onClose={closeApiKeyDialog}
                fullWidth
                maxWidth="sm"
            >
                <Box component="form" onSubmit={handleSaveApiKey}>
                    <DialogTitle>
                        {hasClaudeApiKey
                            ? "Update Claude API Key"
                            : "Add Claude API Key"}
                    </DialogTitle>
                    <DialogContent>
                        <DialogContentText sx={{ mb: 2 }}>
                            Your key is encrypted before it&apos;s stored and is
                            never shared.
                        </DialogContentText>
                        {apiKeyError && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {apiKeyError}
                            </Alert>
                        )}
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
                    </DialogContent>
                    <DialogActions>
                        <Button
                            type="button"
                            onClick={closeApiKeyDialog}
                            disabled={apiKeyLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={apiKeyLoading || !apiKey.trim()}
                        >
                            {apiKeyLoading ? "Saving…" : "Save Key"}
                        </Button>
                    </DialogActions>
                </Box>
            </Dialog>
        </Box>
    );
}
