import { useState } from "react";
import { toast } from "react-toastify";

import { CommentaryHistoryItem, CommentaryResponse } from "@shared/types";

import api from "@/api";
import { Alert, Badge, Button, Card, IconButton } from "@/components/ui";
import Dialog from "@/components/ui/Dialog";
import { ENDPOINTS } from "@/constants/global/endpoints";
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
        <>
            <Card
                variant="sm"
                actions={
                    <>
                        <IconButton
                            icon="delete"
                            label="Delete session"
                            size="sm"
                            tone="danger"
                            disabled={busy}
                            onClick={() => setDeleteDialogOpen(true)}
                        />
                        <span className="ks-history__spacer" />
                        <Button
                            variant="ghost"
                            size="sm"
                            startIcon="download"
                            onClick={handleDownload}
                            disabled={busy}
                        >
                            {isDownloading ? "Downloading…" : "Download .sgf"}
                        </Button>
                        <Button
                            size="sm"
                            endIcon="open_in_new"
                            onClick={handleOpen}
                            disabled={busy}
                        >
                            {isOpening ? "Opening…" : "Open"}
                        </Button>
                    </>
                }
            >
                <div className="ks-history__row">
                    <MiniBoardThumb
                        boardSize={board_size}
                        moves={moves}
                        initialStones={initial_stones}
                        size={88}
                    />
                    <div className="ks-history__meta">
                        <div className="ks-history__name" title={sgf_file_name}>
                            {sgf_file_name}
                        </div>
                        <div className="ks-history__sub">
                            {board_size}×{board_size} · {moves.length} moves ·{" "}
                            {comment_count} comments · {toTitleCase(language)}
                        </div>
                        <div className="ks-history__badges">
                            <Badge tone="neutral">
                                {new Date(created_at).toLocaleString()}
                            </Badge>
                        </div>
                    </div>
                </div>
            </Card>

            <Dialog
                open={deleteDialogOpen}
                size="sm"
                title="Delete this session?"
                onClose={closeDeleteDialog}
                actions={
                    <>
                        <Button
                            variant="ghost"
                            onClick={closeDeleteDialog}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            tone="danger"
                            onClick={handleDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? "Deleting…" : "Delete"}
                        </Button>
                    </>
                }
            >
                <span>
                    The commentary for <strong>{sgf_file_name}</strong> will be
                    permanently removed from your history. This cannot be
                    undone.
                </span>
                {deleteError && <Alert severity="error">{deleteError}</Alert>}
            </Dialog>
        </>
    );
}
