import { useEffect, useRef, useState } from "react";

import { Box } from "@mui/material";

import { DEFAULT_BOARD_CANVAS_SIZE } from "@/constants/game/goBoard";
import { GameMove } from "@/types/game";

import CommentPanel from "./CommentPanel";
import Controls from "./Controls";
import GoBoard from "./GoBoard";

export default function GameViewer({
    boardSize,
    boardCanvasSize = DEFAULT_BOARD_CANVAS_SIZE,
    moves,
    initialStones = [],
    comments,
    currentMoveIndex,
    setCurrentMoveIndex,
}: {
    boardSize: number;
    boardCanvasSize?: number;
    moves: GameMove[];
    initialStones?: GameMove[];
    comments: Record<number, string>;
    currentMoveIndex: number;
    setCurrentMoveIndex: (index: number) => void;
}) {
    const commentedTurns = Object.keys(comments).map((turn) => parseInt(turn));
    const currentComment = comments[currentMoveIndex] ?? null;

    const onMoveChange = (amount: number) => {
        const next = currentMoveIndex + amount;
        setCurrentMoveIndex(Math.max(0, Math.min(next, moves.length)));
    };

    function handleJumpToComment(direction: "prev" | "next") {
        if (direction === "prev") {
            const previous = [...commentedTurns]
                .reverse()
                .find((turn) => turn < currentMoveIndex);
            if (previous) setCurrentMoveIndex(previous);
            return;
        }
        const next = commentedTurns.find((turn) => turn > currentMoveIndex);
        if (next) setCurrentMoveIndex(next);
    }

    const boardColumnRef = useRef<HTMLDivElement>(null);
    const [boardColumnHeight, setBoardColumnHeight] = useState<number>();

    useEffect(() => {
        const element = boardColumnRef.current;
        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            setBoardColumnHeight(entry.contentRect.height);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: { xs: "column", md: "row" },
                gap: 2,
                alignItems: { xs: "center", md: "flex-start" },
                width: "100%",
            }}
        >
            <Box
                ref={boardColumnRef}
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                }}
            >
                <GoBoard
                    boardSize={boardSize}
                    boardCanvasSize={boardCanvasSize}
                    moves={moves}
                    initialStones={initialStones}
                    comments={comments}
                    currentMoveIndex={currentMoveIndex}
                    onMoveChange={onMoveChange}
                />
                <Controls
                    maxMove={moves.length}
                    currentMoveIndex={currentMoveIndex}
                    onMoveChange={onMoveChange}
                    onJumpToPreviousComment={() => handleJumpToComment("prev")}
                    onJumpToNextComment={() => handleJumpToComment("next")}
                    hasPreviousCommentMove={commentedTurns.some(
                        (turn) => turn < currentMoveIndex
                    )}
                    hasNextCommentMove={commentedTurns.some(
                        (turn) => turn > currentMoveIndex
                    )}
                    sx={{
                        borderRadius: 2,
                        mt: 1,
                        width: "100%",
                        maxWidth: boardCanvasSize,
                    }}
                />
            </Box>
            <CommentPanel
                boardCanvasSize={boardCanvasSize}
                moves={moves}
                currentMoveIndex={currentMoveIndex}
                currentComment={currentComment}
                panelHeight={boardColumnHeight}
            />
        </Box>
    );
}
