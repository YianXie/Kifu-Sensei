import { useState } from "react";

import {
    Alert,
    Box,
    Button,
    Divider,
    TextField,
    Typography,
} from "@mui/material";

import { toast } from "react-toastify";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Profile() {
    usePageTitle("Profile");

    const { user, logout } = useAuth();

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

    async function handleUpdateEmail(e: React.FormEvent) {
        e.preventDefault();
        setEmailError(null);
        setEmailLoading(true);
        try {
            await api.post(ENDPOINTS.updateEmail, { email: newEmail, password: emailPassword });
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
            setPasswordError(getErrorMessage(err, "Failed to update password."));
        } finally {
            setPasswordLoading(false);
        }
    }

    async function handleDeleteAccount() {
        if (!window.confirm("This will permanently delete your account. Are you sure?")) return;
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

            {/* Update Email */}
            <Typography variant="h6" fontWeight={600} mb={2}>
                Update Email
            </Typography>
            {emailError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {emailError}
                </Alert>
            )}
            <Box component="form" onSubmit={handleUpdateEmail} className="flex flex-col gap-3 mb-6">
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
                <Button type="submit" variant="outlined" disabled={emailLoading}>
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
                className="flex flex-col gap-3 mb-6"
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
                <Button type="submit" variant="outlined" disabled={passwordLoading}>
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
