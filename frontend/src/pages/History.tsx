import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import { Box, Stack, Typography } from "@mui/material";

import api from "@/api";
import HistoryCard from "@/components/history/HistoryCard";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { usePageTitle } from "@/hooks/usePageTitle";
import { UserCommentaryHistory } from "@/types/auth";
import { CommentaryResponse } from "@/types/commentary";

export default function History() {
    usePageTitle("History");

    const navigate = useNavigate();
    const [commentaries, setCommentaries] = useState<
        CommentaryResponse[] | null
    >(null);

    useEffect(() => {
        async function getUserCommentHistory() {
            try {
                const { data } = await api.get<UserCommentaryHistory>(
                    ENDPOINTS.userCommentaryHistory
                );
                setCommentaries(data.commentaries);
            } catch (error) {
                console.error("Error fetching user commentary history:", error);
                toast.error("Error fetching user commentary history");
            }
        }
        getUserCommentHistory();
    }, []);

    const handleOpen = (commentary: CommentaryResponse) => {
        // pass the game to Commentary page however you route it
        navigate("/commentary", { state: { commentary } });
    };

    return (
        <Box sx={{ px: { xs: 3, md: 5 }, py: 4 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
                Commentary History
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {commentaries?.length ?? 0} sessions
            </Typography>
            <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
                {commentaries?.map((c, i) => (
                    <HistoryCard key={i} commentary={c} onOpen={handleOpen} />
                ))}
            </Stack>
        </Box>
    );
}
