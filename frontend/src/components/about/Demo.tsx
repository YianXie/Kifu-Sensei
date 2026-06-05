import { useMemo, useState } from "react";

import { DEMO_DATA } from "@/constants";

import GoBoard from "../commentary/GoBoard";

export default function Demo({
    boardCanvasSize,
}: {
    boardCanvasSize?: number;
}) {
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

    return (
        <GoBoard
            boardSize={DEMO_DATA.board_size}
            boardCanvasSize={boardCanvasSize}
            moves={DEMO_DATA.moves}
            initialStones={DEMO_DATA.initial_stones}
            comments={commentsByTurn}
            currentMoveIndex={currentMoveIndex}
            setCurrentMoveIndex={setCurrentMoveIndex}
        />
    );
}
