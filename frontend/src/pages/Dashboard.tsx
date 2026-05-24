import { useEffect, useState } from "react";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import {
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    TextField,
    Typography,
} from "@mui/material";

import { toast } from "react-toastify";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Item, ItemCreate } from "@/types/api";
import { getErrorMessage } from "@/utils/errorFormatting";

export default function Dashboard() {
    usePageTitle("Dashboard");

    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState<ItemCreate>({ title: "", description: "" });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchItems();
    }, []);

    async function fetchItems() {
        try {
            const { data } = await api.get<Item[]>(ENDPOINTS.items);
            setItems(data);
        } catch (err) {
            toast.error(getErrorMessage(err, "Failed to load items."));
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        try {
            const { data } = await api.post<Item>(ENDPOINTS.items, form);
            setItems((prev) => [data, ...prev]);
            setDialogOpen(false);
            setForm({ title: "", description: "" });
            toast.success("Item created.");
        } catch (err) {
            toast.error(getErrorMessage(err, "Failed to create item."));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id: string) {
        try {
            await api.delete(ENDPOINTS.item(id));
            setItems((prev) => prev.filter((item) => item.id !== id));
            toast.success("Item deleted.");
        } catch (err) {
            toast.error(getErrorMessage(err, "Failed to delete item."));
        }
    }

    return (
        <Box>
            <Box className="mb-6 flex items-center justify-between">
                <Typography variant="h4" fontWeight={700}>
                    Dashboard
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setDialogOpen(true)}
                >
                    New Item
                </Button>
            </Box>

            {loading ? (
                <Box className="flex justify-center py-16">
                    <CircularProgress />
                </Box>
            ) : items.length === 0 ? (
                <Typography color="text.secondary">
                    No items yet. Create your first one above.
                </Typography>
            ) : (
                <Box className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((item) => (
                        <Card key={item.id} variant="outlined">
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    {item.title}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {item.description || "No description."}
                                </Typography>
                            </CardContent>
                            <CardActions sx={{ justifyContent: "flex-end" }}>
                                <IconButton
                                    size="small"
                                    onClick={() => handleDelete(item.id)}
                                    color="error"
                                >
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </CardActions>
                        </Card>
                    ))}
                </Box>
            )}

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>New Item</DialogTitle>
                <Box component="form" onSubmit={handleCreate}>
                    <DialogContent className="flex flex-col gap-4">
                        <TextField
                            label="Title"
                            value={form.title}
                            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                            required
                            fullWidth
                            autoFocus
                        />
                        <TextField
                            label="Description"
                            value={form.description}
                            onChange={(e) =>
                                setForm((f) => ({ ...f, description: e.target.value }))
                            }
                            fullWidth
                            multiline
                            rows={3}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button type="submit" variant="contained" disabled={submitting}>
                            {submitting ? "Creating…" : "Create"}
                        </Button>
                    </DialogActions>
                </Box>
            </Dialog>
        </Box>
    );
}
