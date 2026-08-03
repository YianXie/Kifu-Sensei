import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import {
    Box,
    Button,
    CircularProgress,
    Stack,
    Typography,
} from "@mui/material";

import api from "@/api";
import HistoryCard from "@/components/history/HistoryCard";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { usePageTitle } from "@/hooks/usePageTitle";
import { UserCommentaryHistory } from "@/types/auth";
import { CommentaryHistoryItem, CommentaryResponse } from "@/types/commentary";
import { getErrorMessage } from "@/utils/errorFormatting";

const PAGE_SIZE = 20;

type Status = "loading" | "loaded" | "error";

export default function History() {
    usePageTitle("History");

    const navigate = useNavigate();
    const [commentaries, setCommentaries] = useState<CommentaryHistoryItem[]>(
        []
    );
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState<Status>("loading");
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const loadPage = useCallback(async (offset: number) => {
        const { data } = await api.get<UserCommentaryHistory>(
            ENDPOINTS.userCommentaryHistory,
            { params: { limit: PAGE_SIZE, offset } }
        );
        return data;
    }, []);

    useEffect(() => {
        let cancelled = false;
        setStatus("loading");
        loadPage(0)
            .then((data) => {
                if (cancelled) return;
                setCommentaries(data.commentaries);
                setTotal(data.total);
                setStatus("loaded");
            })
            .catch((error) => {
                if (cancelled) return;
                console.error("Error fetching user commentary history:", error);
                setStatus("error");
            });
        return () => {
            cancelled = true;
        };
    }, [loadPage]);

    async function handleRetry() {
        setStatus("loading");
        try {
            const data = await loadPage(0);
            setCommentaries(data.commentaries);
            setTotal(data.total);
            setStatus("loaded");
        } catch (error) {
            console.error("Error fetching user commentary history:", error);
            setStatus("error");
        }
    }

    async function handleLoadMore() {
        setIsLoadingMore(true);
        try {
            const data = await loadPage(commentaries.length);
            setCommentaries((prev) => [...prev, ...data.commentaries]);
            setTotal(data.total);
        } catch (error) {
            toast.error(
                getErrorMessage(error, "Could not load more sessions.")
            );
        } finally {
            setIsLoadingMore(false);
        }
    }

    const handleOpen = (commentary: CommentaryResponse) => {
        navigate("/commentary", { state: { commentary } });
    };

    const handleDelete = (id: number) => {
        setCommentaries((prev) => prev.filter((c) => c.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
    };

    return (
        <Box sx={{ px: { xs: 3, md: 5 }, py: 4 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
                Commentary History
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {status === "loaded"
                    ? `${total} session${total === 1 ? "" : "s"}`
                    : " "}
            </Typography>

            {status === "loading" && (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2,
                        py: 8,
                    }}
                >
                    <CircularProgress size={40} />
                    <Typography color="text.secondary">
                        Loading your history…
                    </Typography>
                </Box>
            )}

            {status === "error" && (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        textAlign: "center",
                        gap: 1.5,
                        py: 8,
                    }}
                >
                    <ErrorOutlinedIcon color="error" sx={{ fontSize: 48 }} />
                    <Typography sx={{ fontWeight: 600 }}>
                        Could not load your history
                    </Typography>
                    <Typography color="text.secondary" sx={{ maxWidth: 360 }}>
                        Something went wrong while fetching your saved sessions.
                    </Typography>
                    <Button variant="outlined" onClick={handleRetry}>
                        Retry
                    </Button>
                </Box>
            )}

            {status === "loaded" && commentaries.length === 0 && (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        textAlign: "center",
                        gap: 1.5,
                        py: 8,
                    }}
                >
                    <HistoryOutlinedIcon
                        color="disabled"
                        sx={{ fontSize: 48 }}
                    />
                    <Typography sx={{ fontWeight: 600 }}>
                        No sessions yet
                    </Typography>
                    <Typography color="text.secondary" sx={{ maxWidth: 360 }}>
                        Generate commentary on a game and it will show up here.
                    </Typography>
                    <Button
                        variant="contained"
                        onClick={() => navigate("/commentary")}
                    >
                        Generate commentary
                    </Button>
                </Box>
            )}

            {status === "loaded" && commentaries.length > 0 && (
                <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
                    {commentaries.map((c) => (
                        <HistoryCard
                            key={c.id}
                            commentary={c}
                            onOpen={handleOpen}
                            onDelete={handleDelete}
                        />
                    ))}
                    {commentaries.length < total && (
                        <Button
                            variant="outlined"
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            sx={{ alignSelf: "center", mt: 1 }}
                        >
                            {isLoadingMore ? "Loading…" : "Load more"}
                        </Button>
                    )}
                </Stack>
            )}
        </Box>
    );
}
