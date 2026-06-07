import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";

import { CommentaryResponse } from "@/types/commentary";
import { toTitleCase } from "@/utils/string";

import MiniBoardThumb from "./MiniBoardThumb";

export default function HistoryCard({
    commentary,
    onOpen,
}: {
    commentary: CommentaryResponse;
    onOpen: (commentary: CommentaryResponse) => void;
}) {
    const {
        board_size,
        sgf_file_name,
        language,
        moves,
        initial_stones,
        comments,
        annotated_sgf_content,
    } = commentary;

    function handleDownload() {
        if (!annotated_sgf_content) return;
        const blob = new Blob([annotated_sgf_content], {
            type: "application/x-go-sgf",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sgf_file_name.replace(/\.sgf$/i, "") + "_annotated.sgf";
        a.click();
        URL.revokeObjectURL(url);
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
                        moves &nbsp;·&nbsp; {comments.length} comments
                        &nbsp;·&nbsp; {toTitleCase(language)}
                    </Typography>
                </Box>
            </CardContent>

            <Divider />

            <CardActions sx={{ justifyContent: "flex-end", px: 1, py: 0.75 }}>
                {annotated_sgf_content && (
                    <Button
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={handleDownload}
                    >
                        Download .sgf
                    </Button>
                )}
                <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    endIcon={
                        <OpenInNewIcon sx={{ fontSize: "14px !important" }} />
                    }
                    onClick={() => onOpen(commentary)}
                >
                    Open
                </Button>
            </CardActions>
        </Card>
    );
}
