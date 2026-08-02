import { useState } from "react";
import { toast } from "react-toastify";

import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
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
}: {
    commentary: CommentaryHistoryItem;
    onOpen: (commentary: CommentaryResponse) => void;
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
    const busy = isOpening || isDownloading;

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

            <CardActions sx={{ justifyContent: "flex-end", px: 1, py: 0.75 }}>
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
        </Card>
    );
}
