import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { readCommentaryConfig } from "@shared/commentary";
import { type ClaudeModel, CommentaryLanguage } from "@shared/types";

import api from "@/api";
import CommentaryConfig from "@/components/commentary/CommentaryConfig";
import {
    Alert,
    Button,
    Dialog,
    Divider,
    Field,
    Input,
    SegmentedControl,
    Switch,
    Tabs,
} from "@/components/ui";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { UserSettings } from "@/types/auth";
import { type ThemePreference, isThemePreference } from "@/types/theme";
import { getErrorMessage } from "@/utils/errorFormatting";
import { readPlayStoneSound } from "@/utils/preferences";

const TABS = ["Account", "Default commentary config", "Miscellaneous"] as const;
type SettingsTab = (typeof TABS)[number];

const THEME_OPTIONS = [
    { value: "system", label: "System", icon: "contrast" },
    { value: "light", label: "Light", icon: "light_mode" },
    { value: "dark", label: "Dark", icon: "dark_mode" },
] as const satisfies readonly {
    value: ThemePreference;
    label: string;
    icon: "contrast" | "light_mode" | "dark_mode";
}[];

export default function Settings() {
    usePageTitle("Settings");

    const { user, userSettings, updateUserSettings, logout } = useAuth();
    const { preference: themePreference, setPreference: setThemePreference } =
        useTheme();

    const prefs = userSettings?.preferences ?? {};

    const [tab, setTab] = useState<SettingsTab>("Account");

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
    const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] =
        useState(false);

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

    const [playStoneSound, setPlayStoneSound] = useState(() =>
        readPlayStoneSound(prefs)
    );
    const [themeError, setThemeError] = useState<string | null>(null);
    const [themeLoading, setThemeLoading] = useState(false);

    const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [apiKeyLoading, setApiKeyLoading] = useState(false);
    const [deleteApiKeyDialogOpen, setDeleteApiKeyDialogOpen] = useState(false);
    const [deleteApiKeyError, setDeleteApiKeyError] = useState<string | null>(
        null
    );
    const [deleteApiKeyLoading, setDeleteApiKeyLoading] = useState(false);
    const hasClaudeApiKey = userSettings?.has_claude_api_key ?? false;

    const passwordMismatch =
        confirmPassword.length > 0 && newPassword !== confirmPassword;

    // Adopt the stored sound preference once settings arrive. The theme is
    // hydrated the same way, inside ThemeProvider.
    useEffect(() => {
        setPlayStoneSound(readPlayStoneSound(prefs));
    }, [prefs.play_stone_sound]); // eslint-disable-line react-hooks/exhaustive-deps

    async function handleUpdateTheme() {
        setThemeLoading(true);
        setThemeError(null);
        try {
            const { data } = await api.put<UserSettings>(
                ENDPOINTS.userSettings,
                {
                    preferences: {
                        theme: themePreference,
                        play_stone_sound: playStoneSound,
                    },
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
                            language,
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

    async function handleDeleteApiKey() {
        setDeleteApiKeyError(null);
        setDeleteApiKeyLoading(true);
        try {
            const { data } = await api.delete<UserSettings>(
                ENDPOINTS.claudeApiKey
            );
            updateUserSettings(data);
            toast.success("Claude API key deleted.");
            setDeleteApiKeyDialogOpen(false);
        } catch (err) {
            setDeleteApiKeyError(
                getErrorMessage(err, "Failed to delete API key.")
            );
        } finally {
            setDeleteApiKeyLoading(false);
        }
    }

    function closeDeleteApiKeyDialog() {
        if (deleteApiKeyLoading) return;
        setDeleteApiKeyDialogOpen(false);
        setDeleteApiKeyError(null);
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
        setDeleteError(null);
        setDeleteLoading(true);
        try {
            await api.delete(ENDPOINTS.deleteAccount, {
                data: { password: deletePassword },
            });
            setDeleteAccountDialogOpen(false);
            logout();
        } catch (err) {
            setDeleteError(getErrorMessage(err, "Failed to delete account."));
        } finally {
            setDeleteLoading(false);
        }
    }

    return (
        <div className="ks-container ks-container--lg ks-page">
            <span className="ks-eyebrow">Account</span>
            <h1 className="ks-page__title">Settings</h1>
            <p
                className="ks-page__meta"
                style={{ marginBottom: "var(--space-12)" }}
            >
                {user?.email}
            </p>

            <Tabs tabs={TABS} value={tab} onChange={setTab} />

            {/* ── Account ──────────────────────────────────────────────── */}
            {tab === "Account" && (
                <div
                    className="ks-stack"
                    style={{
                        marginTop: "var(--space-13)",
                        gap: "var(--space-12)",
                        maxWidth: 480,
                    }}
                >
                    <section className="ks-form-stack">
                        <h2 className="ks-heading" style={{ margin: 0 }}>
                            Update email
                        </h2>
                        {emailError && (
                            <Alert severity="error">{emailError}</Alert>
                        )}
                        <form
                            className="ks-form-stack"
                            onSubmit={handleUpdateEmail}
                        >
                            <Field label="New email" htmlFor="s-email">
                                <Input
                                    id="s-email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={newEmail}
                                    onChange={(e) =>
                                        setNewEmail(e.target.value)
                                    }
                                    required
                                />
                            </Field>
                            <Field label="Current password" htmlFor="s-pw1">
                                <Input
                                    id="s-pw1"
                                    type="password"
                                    value={emailPassword}
                                    onChange={(e) =>
                                        setEmailPassword(e.target.value)
                                    }
                                    required
                                    autoComplete="current-password"
                                />
                            </Field>
                            <div style={{ alignSelf: "flex-start" }}>
                                <Button
                                    type="submit"
                                    variant="outline"
                                    disabled={emailLoading}
                                >
                                    {emailLoading
                                        ? "Updating…"
                                        : "Update email"}
                                </Button>
                            </div>
                        </form>
                    </section>

                    <Divider spacing="8px" />

                    <section className="ks-form-stack">
                        <h2 className="ks-heading" style={{ margin: 0 }}>
                            Update password
                        </h2>
                        {passwordError && (
                            <Alert severity="error">{passwordError}</Alert>
                        )}
                        <form
                            className="ks-form-stack"
                            onSubmit={handleUpdatePassword}
                        >
                            <Field label="Current password" htmlFor="s-pw2">
                                <Input
                                    id="s-pw2"
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) =>
                                        setCurrentPassword(e.target.value)
                                    }
                                    required
                                    autoComplete="current-password"
                                />
                            </Field>
                            <Field
                                label="New password"
                                htmlFor="s-pw3"
                                hint="At least 8 characters."
                            >
                                <Input
                                    id="s-pw3"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) =>
                                        setNewPassword(e.target.value)
                                    }
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                />
                            </Field>
                            <Field
                                label="Confirm new password"
                                htmlFor="s-pw4"
                                error={
                                    passwordMismatch
                                        ? "New passwords do not match."
                                        : undefined
                                }
                            >
                                <Input
                                    id="s-pw4"
                                    type="password"
                                    invalid={passwordMismatch}
                                    value={confirmPassword}
                                    onChange={(e) =>
                                        setConfirmPassword(e.target.value)
                                    }
                                    required
                                    autoComplete="new-password"
                                />
                            </Field>
                            <div style={{ alignSelf: "flex-start" }}>
                                <Button
                                    type="submit"
                                    variant="outline"
                                    disabled={passwordLoading}
                                >
                                    {passwordLoading
                                        ? "Updating…"
                                        : "Update password"}
                                </Button>
                            </div>
                        </form>
                    </section>

                    <Divider spacing="8px" />

                    <section className="ks-form-stack">
                        <h2
                            className="ks-heading ks-danger-heading"
                            style={{ margin: 0 }}
                        >
                            Danger zone
                        </h2>
                        <Alert severity="warning">
                            Deleting your account also deletes every saved
                            review. This cannot be undone.
                        </Alert>
                        {deleteError && (
                            <Alert severity="error">{deleteError}</Alert>
                        )}
                        <Field
                            label="Confirm password to delete"
                            htmlFor="s-del"
                        >
                            <Input
                                id="s-del"
                                type="password"
                                value={deletePassword}
                                onChange={(e) =>
                                    setDeletePassword(e.target.value)
                                }
                                autoComplete="current-password"
                            />
                        </Field>
                        <div style={{ alignSelf: "flex-start" }}>
                            <Button
                                variant="outline"
                                tone="danger"
                                onClick={() => setDeleteAccountDialogOpen(true)}
                                disabled={deleteLoading || !deletePassword}
                            >
                                Delete account
                            </Button>
                        </div>
                    </section>
                </div>
            )}

            {/* ── Default commentary config ────────────────────────────── */}
            {tab === "Default commentary config" && (
                <div
                    className="ks-stack"
                    style={{
                        marginTop: "var(--space-13)",
                        gap: "var(--space-10)",
                    }}
                >
                    <p className="ks-page__lead">
                        These values are used as the defaults on the Commentary
                        page.
                    </p>
                    {configError && (
                        <Alert severity="error">{configError}</Alert>
                    )}
                    <CommentaryConfig
                        idPrefix="defaults"
                        heading="Default commentary config"
                        lead="Every new review starts from these settings."
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
                    <div style={{ alignSelf: "flex-start" }}>
                        <Button
                            variant="outline"
                            onClick={handleSaveCommentaryConfig}
                            disabled={configLoading}
                        >
                            {configLoading ? "Saving…" : "Save defaults"}
                        </Button>
                    </div>
                </div>
            )}

            {/* ── Miscellaneous ────────────────────────────────────────── */}
            {tab === "Miscellaneous" && (
                <div
                    className="ks-stack"
                    style={{
                        marginTop: "var(--space-13)",
                        gap: "var(--space-12)",
                        maxWidth: 520,
                    }}
                >
                    <section className="ks-form-stack">
                        <h2 className="ks-heading" style={{ margin: 0 }}>
                            Theme
                        </h2>
                        {themeError && (
                            <Alert severity="error">{themeError}</Alert>
                        )}
                        <SegmentedControl
                            ariaLabel="Theme"
                            options={THEME_OPTIONS}
                            value={themePreference}
                            onChange={(value) => {
                                if (isThemePreference(value)) {
                                    setThemePreference(value);
                                }
                            }}
                        />
                        <Switch
                            label="Play a stone sound when stepping through moves"
                            checked={playStoneSound}
                            onChange={(e) =>
                                setPlayStoneSound(e.target.checked)
                            }
                        />
                        <div style={{ alignSelf: "flex-start" }}>
                            <Button
                                variant="outline"
                                onClick={handleUpdateTheme}
                                disabled={themeLoading}
                            >
                                {themeLoading ? "Updating…" : "Update theme"}
                            </Button>
                        </div>
                    </section>

                    <Divider spacing="8px" />

                    <section className="ks-form-stack">
                        <h2 className="ks-heading" style={{ margin: 0 }}>
                            Claude API key
                        </h2>
                        <p className="ks-page__lead">
                            {hasClaudeApiKey
                                ? "A Claude API key is set. You can update it with a new key at any time."
                                : "No Claude API key is set yet. Add one to start generating commentary."}
                        </p>
                        <div className="ks-row ks-row--wrap">
                            <Button
                                variant="outline"
                                onClick={() => setApiKeyDialogOpen(true)}
                            >
                                {hasClaudeApiKey
                                    ? "Update Claude API key"
                                    : "Add Claude API key"}
                            </Button>
                            {hasClaudeApiKey && (
                                <Button
                                    variant="outline"
                                    tone="danger"
                                    onClick={() =>
                                        setDeleteApiKeyDialogOpen(true)
                                    }
                                >
                                    Delete Claude API key
                                </Button>
                            )}
                        </div>
                    </section>
                </div>
            )}

            <Dialog
                open={apiKeyDialogOpen}
                title={
                    hasClaudeApiKey
                        ? "Update Claude API key"
                        : "Add Claude API key"
                }
                onClose={closeApiKeyDialog}
                onSubmit={handleSaveApiKey}
                actions={
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={closeApiKeyDialog}
                            disabled={apiKeyLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={apiKeyLoading || !apiKey.trim()}
                        >
                            {apiKeyLoading ? "Saving…" : "Save key"}
                        </Button>
                    </>
                }
            >
                <span>
                    Your key is encrypted before it&apos;s stored and is never
                    shared.
                </span>
                {apiKeyError && <Alert severity="error">{apiKeyError}</Alert>}
                <Field label="Claude API key" htmlFor="dlg-key">
                    <Input
                        id="dlg-key"
                        type="password"
                        mono
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        required
                        autoComplete="off"
                    />
                </Field>
                <span
                    style={{
                        fontSize: "var(--text-2xs)",
                        color: "var(--text-muted)",
                    }}
                >
                    Don&apos;t have a key yet?{" "}
                    <a
                        href="https://console.anthropic.com/settings/keys"
                        target="_blank"
                        rel="noreferrer"
                    >
                        Get one from the Anthropic Console
                    </a>
                    .
                </span>
            </Dialog>

            <Dialog
                open={deleteApiKeyDialogOpen}
                size="sm"
                title="Delete Claude API key?"
                onClose={closeDeleteApiKeyDialog}
                actions={
                    <>
                        <Button
                            variant="ghost"
                            onClick={closeDeleteApiKeyDialog}
                            disabled={deleteApiKeyLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            tone="danger"
                            onClick={handleDeleteApiKey}
                            disabled={deleteApiKeyLoading}
                        >
                            {deleteApiKeyLoading ? "Deleting…" : "Delete key"}
                        </Button>
                    </>
                }
            >
                <span>
                    Do you really want to delete your Claude API key? You
                    won&apos;t be able to generate commentary until you add a
                    new one.
                </span>
                {deleteApiKeyError && (
                    <Alert severity="error">{deleteApiKeyError}</Alert>
                )}
            </Dialog>

            <Dialog
                open={deleteAccountDialogOpen}
                size="sm"
                title="Delete your account?"
                onClose={() => {
                    if (!deleteLoading) setDeleteAccountDialogOpen(false);
                }}
                actions={
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setDeleteAccountDialogOpen(false)}
                            disabled={deleteLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            tone="danger"
                            onClick={handleDeleteAccount}
                            disabled={deleteLoading}
                        >
                            {deleteLoading ? "Deleting…" : "Delete account"}
                        </Button>
                    </>
                }
            >
                This permanently deletes your account and every saved review. It
                cannot be undone.
            </Dialog>
        </div>
    );
}
