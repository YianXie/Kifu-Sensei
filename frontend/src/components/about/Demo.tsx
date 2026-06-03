import { useMemo, useState } from "react";

import { Box } from "@mui/material";

import { DEMO_DATA } from "@/constants";
import { GameMove } from "@/types/game";

import Controls from "../commentary/Controls";
import GoBoard from "../commentary/GoBoard";

export default function Demo() {
    const commentsByTurn = useMemo(() => {
        const map: Record<number, string> = {};
        for (const item of DEMO_DATA.comments) {
            map[item.turn] = item.comment;
        }
        return map;
    }, []);
    const commentedTurns = useMemo(() => {
        return DEMO_DATA.comments.map((item) => item.turn);
    }, []);
    const [currentMoveIndex, setCurrentMoveIndex] = useState(commentedTurns[0]);

    function handleMoveChange(amount: number) {
        setCurrentMoveIndex((prev) =>
            Math.max(0, Math.min(prev + amount, DEMO_DATA.moves.length))
        );
    }

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

    return (
        <Box
            sx={{
                mt: 2,
            }}
        >
            <GoBoard
                boardSize={DEMO_DATA.board_size}
                moves={DEMO_DATA.moves as GameMove[]}
                initialStones={DEMO_DATA.initial_stones}
                commentsByTurn={commentsByTurn}
                currentMoveIndex={currentMoveIndex}
                onMoveIndexChange={setCurrentMoveIndex}
            />
            <Controls
                maxMove={DEMO_DATA.moves.length}
                currentMoveIndex={currentMoveIndex}
                onMoveChange={handleMoveChange}
                onJumpToPreviousComment={() => handleJumpToComment("prev")}
                onJumpToNextComment={() => handleJumpToComment("next")}
                hasPreviousCommentMove={commentedTurns.some(
                    (turn) => turn < currentMoveIndex
                )}
                hasNextCommentMove={commentedTurns.some(
                    (turn) => turn > currentMoveIndex
                )}
                sx={{ borderRadius: 2, mt: 1 }}
            />
        </Box>
    );
}
