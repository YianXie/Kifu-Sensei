import { useState } from "react";
import { toast } from "react-toastify";

import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import api from "@/api";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { CommentaryHistoryItem, CommentaryResponse } from "@/types/commentary";
import { getErrorMessage } from "@/utils/errorFormatting";
import { toTitleCase } from "@/utils/string";

import MiniBoardThumb from "./MiniBoardThumb";

export default function HistoryCard({
    commentary,
    onOpen,
    onDelete,
}: {
    commentary: CommentaryHistoryItem;
    onOpen: (commentary: CommentaryResponse) => void;
    onDelete: (id: number) => void;
}) {
    const {
        id,
        board_size,
        sgf_file_name,
        language,
        moves,
        initial_stones,
        comment_count,
        created_at,
    } = commentary;

    const [isOpening, setIsOpening] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const busy = isOpening || isDownloading || isDeleting;

    async function fetchDetail(): Promise<CommentaryResponse> {
        const { data } = await api.get<CommentaryResponse>(
            ENDPOINTS.userCommentaryHistoryDetail(id)
        );
        return data;
    }

    async function handleOpen() {
        setIsOpening(true);
        try {
            onOpen(await fetchDetail());
        } catch (error) {
            toast.error(getErrorMessage(error, "Could not open this session."));
        } finally {
            setIsOpening(false);
        }
    }

    async function handleDownload() {
        setIsDownloading(true);
        try {
            const detail = await fetchDetail();
            const blob = new Blob([detail.annotated_sgf_content], {
                type: "application/x-go-sgf",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download =
                sgf_file_name.replace(/\.sgf$/i, "") + "_annotated.sgf";
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            toast.error(
                getErrorMessage(error, "Could not download this session.")
            );
        } finally {
            setIsDownloading(false);
        }
    }

    function closeDeleteDialog() {
        if (isDeleting) return;
        setDeleteDialogOpen(false);
        setDeleteError(null);
    }

    async function handleDelete() {
        setIsDeleting(true);
        setDeleteError(null);
        try {
            await api.delete(ENDPOINTS.userCommentaryHistoryDetail(id));
            toast.success("Session deleted.");
            setDeleteDialogOpen(false);
            // Last, since the parent unmounts this card in response.
            onDelete(id);
        } catch (error) {
            setDeleteError(
                getErrorMessage(error, "Could not delete this session.")
            );
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <Card variant="outlined">
            <CardContent
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    "&:last-child": { pb: "14px" },
                    pb: "14px",
                }}
            >
                {/* Mini board thumbnail */}
                <Box
                    sx={{
                        flexShrink: 0,
                        borderRadius: "3px",
                        overflow: "hidden",
                        lineHeight: 0,
                        boxShadow: 1,
                    }}
                >
                    <MiniBoardThumb
                        boardSize={board_size}
                        moves={moves}
                        initialStones={initial_stones}
                        size={88}
                    />
                </Box>

                {/* Metadata */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        variant="subtitle2"
                        noWrap
                        title={sgf_file_name}
                        sx={{ fontWeight: 600 }}
                    >
                        {sgf_file_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {board_size}×{board_size} &nbsp;·&nbsp; {moves.length}{" "}
                        moves &nbsp;·&nbsp; {comment_count} comments
                        &nbsp;·&nbsp; {toTitleCase(language)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {new Date(created_at).toLocaleString()}
                    </Typography>
                </Box>
            </CardContent>

            <Divider />

            <CardActions sx={{ px: 1, py: 0.75 }}>
                <Tooltip title="Delete session">
                    {/* The span keeps the tooltip working while the button is disabled. */}
                    <span>
                        <IconButton
                            size="small"
                            color="error"
                            aria-label="Delete session"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={busy}
                        >
                            {isDeleting ? (
                                <CircularProgress size={18} color="error" />
                            ) : (
                                <DeleteOutlinedIcon fontSize="small" />
                            )}
                        </IconButton>
                    </span>
                </Tooltip>

                <Box sx={{ flex: 1 }} />

                <Button
                    size="small"
                    startIcon={
                        isDownloading ? (
                            <CircularProgress size={14} />
                        ) : (
                            <DownloadIcon />
                        )
                    }
                    onClick={handleDownload}
                    disabled={busy}
                >
                    Download .sgf
                </Button>
                <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    endIcon={
                        isOpening ? (
                            <CircularProgress
                                size={14}
                                sx={{ color: "inherit" }}
                            />
                        ) : (
                            <OpenInNewIcon
                                sx={{ fontSize: "14px !important" }}
                            />
                        )
                    }
                    onClick={handleOpen}
                    disabled={busy}
                >
                    Open
                </Button>
            </CardActions>

            <Dialog
                open={deleteDialogOpen}
                onClose={closeDeleteDialog}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>Delete this session?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        The commentary for <strong>{sgf_file_name}</strong> will
                        be permanently removed from your history. This cannot be
                        undone.
                    </DialogContentText>
                    {deleteError && (
                        <Alert severity="error">{deleteError}</Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="contained"
                        onClick={closeDeleteDialog}
                        disabled={isDeleting}
                    >
                        Cancel
                    </Button>
                    <Button
                        color="error"
                        onClick={handleDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? "Deleting…" : "Delete"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
}
