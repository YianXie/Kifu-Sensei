import { Box, Paper, Typography } from "@mui/material";

import { GameMove } from "@/types/game";

export default function CommentPanel({
    boardCanvasSize,
    moves,
    currentMoveIndex,
    currentComment,
    panelHeight,
}: {
    boardCanvasSize: number;
    moves: GameMove[];
    currentMoveIndex: number;
    currentComment: string;
    panelHeight?: number;
}) {
    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                width: { xs: "100%", md: "auto" },
                height: {
                    md: panelHeight ? `${panelHeight}px` : undefined,
                },
            }}
        >
            <Paper
                variant="outlined"
                sx={{
                    flex: 1,
                    minWidth: { md: 280 },
                    width: { xs: "100%", md: boardCanvasSize / 3 },
                    minHeight: { xs: 200, md: "unset" },
                    maxHeight: { xs: 350, md: "none" },
                    height: { md: panelHeight ? "100%" : undefined },
                    p: 2,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    overflow: "hidden",
                }}
            >
                <Typography variant="subtitle2" color="text.secondary">
                    Move {currentMoveIndex} / {moves.length}
                </Typography>
                <Box
                    role="status"
                    aria-live="polite"
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        pr: 0.5,
                        scrollbarWidth: "none",
                    }}
                >
                    {currentComment ? (
                        <Typography variant="body2">
                            {currentComment}
                        </Typography>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            {currentMoveIndex === 0
                                ? "Starting position — no commentary for this turn."
                                : "No commentary was generated for this move."}
                        </Typography>
                    )}
                </Box>
            </Paper>
        </Box>
    );
}
