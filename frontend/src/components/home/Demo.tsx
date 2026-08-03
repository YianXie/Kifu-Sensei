import { useMemo, useState } from "react";

import { DEMO_DATA } from "@/constants/commentary/demo";
import { useAuth } from "@/contexts/AuthContext";
import { type CommentarySeverity, severityForDelta } from "@/utils/commentary";
import { readPlayStoneSound } from "@/utils/preferences";

import GameViewer from "../game/GameViewer";

export default function Demo({
    boardCanvasSize,
}: {
    boardCanvasSize?: number;
}) {
    const { userSettings } = useAuth();

    const commentsByTurn = useMemo(() => {
        const map: Record<number, string> = {};
        for (const item of DEMO_DATA.comments) {
            map[item.turn] = item.comment;
        }
        return map;
    }, []);
    const severityByTurn = useMemo(() => {
        const map: Record<number, CommentarySeverity> = {};
        for (const item of DEMO_DATA.comments) {
            map[item.turn] = severityForDelta(item.winrate_delta);
        }
        return map;
    }, []);
    const commentedTurns = useMemo(() => {
        return DEMO_DATA.comments.map((item) => item.turn);
    }, []);

    const [currentMoveIndex, setCurrentMoveIndex] = useState(commentedTurns[0]);

    return (
        <GameViewer
            boardSize={DEMO_DATA.board_size}
            boardCanvasSize={boardCanvasSize}
            moves={DEMO_DATA.moves}
            initialStones={DEMO_DATA.initial_stones}
            comments={commentsByTurn}
            severityByTurn={severityByTurn}
            currentMoveIndex={currentMoveIndex}
            setCurrentMoveIndex={setCurrentMoveIndex}
            soundEnabled={readPlayStoneSound(userSettings?.preferences)}
            compact
        />
    );
}
