import { useState } from "react";

import {
    Alert,
    Box,
    Button,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    Typography,
} from "@mui/material";

import { toast } from "react-toastify";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Settings() {
    usePageTitle("Settings");

    const { userSettings, updateUserSettings } = useAuth();

    const prefs = userSettings?.preferences ?? {};
    const [theme, setTheme] = useState<string>((prefs.theme as string) ?? "system");
    const [notifications, setNotifications] = useState<boolean>(
        (prefs.notifications_enabled as boolean) ?? true,
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            const { data } = await api.put(ENDPOINTS.userSettings, {
                preferences: { theme, notifications_enabled: notifications },
            });
            updateUserSettings(data);
            toast.success("Settings saved.");
        } catch (err) {
            setError(getErrorMessage(err, "Failed to save settings."));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Box maxWidth={480}>
            <Typography variant="h4" fontWeight={700} mb={4}>
                Settings
            </Typography>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            <Box className="flex flex-col gap-6">
                <FormControl fullWidth>
                    <InputLabel>Theme</InputLabel>
                    <Select
                        value={theme}
                        label="Theme"
                        onChange={(e) => setTheme(e.target.value)}
                    >
                        <MenuItem value="system">System</MenuItem>
                        <MenuItem value="light">Light</MenuItem>
                        <MenuItem value="dark">Dark</MenuItem>
                    </Select>
                </FormControl>

                <Box className="flex items-center justify-between">
                    <Box>
                        <Typography variant="body1" fontWeight={500}>
                            Notifications
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Receive in-app notifications
                        </Typography>
                    </Box>
                    <Switch
                        checked={notifications}
                        onChange={(e) => setNotifications(e.target.checked)}
                    />
                </Box>

                <Button variant="contained" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save Settings"}
                </Button>
            </Box>
        </Box>
    );
}
