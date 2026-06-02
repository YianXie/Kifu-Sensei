import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
    Alert,
    Box,
    Button,
    Divider,
    MenuItem,
    Select,
    TextField,
    Typography,
} from "@mui/material";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Settings() {
    usePageTitle("Settings");

    const { user, userSettings, updateUserSettings, logout } = useAuth();

    const prefs = userSettings?.preferences ?? {};
    const [theme, setTheme] = useState<string>(
        (prefs.theme as string) ?? "system"
    );
    const [themeError, setThemeError] = useState<string | null>("");
    const [themeLoading, setThemeLoading] = useState(false);

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
    const [deleteLoading, setDeleteLoading] = useState(false);

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
            const { data } = await api.put(ENDPOINTS.userSettings, {
                preferences: { theme },
            });
            updateUserSettings(data);
            toast.success("Settings saved.");
        } catch (err) {
            setThemeError(getErrorMessage(err, "Failed to save settings."));
        } finally {
            setThemeLoading(false);
        }
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
        setDeleteLoading(true);
        try {
            await api.delete(ENDPOINTS.deleteAccount);
            logout();
        } catch (err) {
            toast.error(getErrorMessage(err, "Failed to delete account."));
        } finally {
            setDeleteLoading(false);
        }
    }

    return (
        <Box maxWidth={480}>
            <Typography variant="h4" fontWeight={700} mb={1}>
                Profile
            </Typography>
            <Typography color="text.secondary" mb={4}>
                {user?.email}
            </Typography>

            {/* Update theme */}
            <Typography variant="h6" fontWeight={600} mb={2}>
                Update Theme
            </Typography>
            {themeError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {themeError}
                </Alert>
            )}
            <Box
                component="form"
                onSubmit={handleUpdateTheme}
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1.5,
                    mb: 3,
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

            {/* Update Email */}
            <Typography variant="h6" fontWeight={600} mb={2}>
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

            {/* Update Password */}
            <Typography variant="h6" fontWeight={600} mb={2}>
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
                    inputProps={{ minLength: 8 }}
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

            {/* Delete Account */}
            <Typography variant="h6" fontWeight={600} mb={2} color="error">
                Danger Zone
            </Typography>
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
    );
}
