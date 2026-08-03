import { type ReactNode, useEffect, useRef, useState } from "react";

import { DEFAULT_BOARD_CANVAS_SIZE } from "@/constants/game/goBoard";
import { GameMove } from "@/types/game";
import { type CommentarySeverity, colorForTurn } from "@/utils/commentary";

import CommentPanel from "./CommentPanel";
import Controls from "./Controls";
import GoBoard from "./GoBoard";

export default function GameViewer({
    boardSize,
    boardCanvasSize = DEFAULT_BOARD_CANVAS_SIZE,
    moves,
    initialStones = [],
    comments,
    severityByTurn,
    currentMoveIndex,
    setCurrentMoveIndex,
    soundEnabled = true,
    commentPanelHeight,
    compact = false,
    children,
}: {
    boardSize: number;
    boardCanvasSize?: number;
    moves: GameMove[];
    initialStones?: GameMove[];
    comments: Record<number, string>;
    severityByTurn?: Record<number, CommentarySeverity>;
    currentMoveIndex: number;
    setCurrentMoveIndex: (index: number) => void;
    soundEnabled?: boolean;
    /**
     * Fixed height for the comment panel. Set it when `children` fill the rest
     * of the side column; leave it off and the panel takes the whole column.
     */
    commentPanelHeight?: number;
    /** Narrower board/panel proportions, for the home page's inline demo. */
    compact?: boolean;
    /** Rendered under the comment panel — the review screen's card list. */
    children?: ReactNode;
}) {
    const commentedTurns = Object.keys(comments).map((turn) => parseInt(turn));
    const currentComment = comments[currentMoveIndex] ?? "";

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
        <div className={`ks-review${compact ? " ks-review--compact" : ""}`}>
            <div
                className="ks-review__board"
                ref={boardColumnRef}
                style={{ width: boardCanvasSize }}
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
                    soundEnabled={soundEnabled}
                />
            </div>
            <div
                className="ks-review__side"
                // Matching the board column keeps the two edges aligned and gives
                // the comment list a bounded box to scroll inside.
                style={
                    boardColumnHeight
                        ? { height: boardColumnHeight }
                        : undefined
                }
            >
                <CommentPanel
                    moves={moves}
                    currentMoveIndex={currentMoveIndex}
                    currentComment={currentComment}
                    color={
                        currentMoveIndex > 0
                            ? colorForTurn(moves, currentMoveIndex)
                            : null
                    }
                    severity={
                        currentComment
                            ? (severityByTurn?.[currentMoveIndex] ?? null)
                            : null
                    }
                    panelHeight={children ? commentPanelHeight : undefined}
                />
                {children}
            </div>
        </div>
    );
}
