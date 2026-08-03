import { Badge } from "@/components/ui";
import type { GameMove } from "@/types/game";
import type { CommentarySeverity } from "@/utils/commentary";

const SEVERITY_LABEL: Record<CommentarySeverity, string> = {
    blunder: "Blunder",
    mistake: "Mistake",
    notable: "Notable",
};

/** The commentary sidebar next to the board. */
export default function CommentPanel({
    moves,
    currentMoveIndex,
    currentComment,
    color,
    severity,
    panelHeight,
}: {
    moves: GameMove[];
    currentMoveIndex: number;
    currentComment: string;
    /** Colour of the player who made the current move, when there is one. */
    color?: "B" | "W" | null;
    /** Severity tier of the current move, when it has a comment. */
    severity?: CommentarySeverity | null;
    /** Fixed height in px. Left unset, the panel fills its flex column. */
    panelHeight?: number;
}) {
    return (
        <aside
            className="ks-comment-panel"
            style={
                panelHeight
                    ? { height: panelHeight, flex: "0 0 auto" }
                    : { flex: 1 }
            }
        >
            <div className="ks-comment-panel__head">
                <span className="ks-comment-panel__turn">
                    Move {currentMoveIndex} / {moves.length}
                </span>
                <span style={{ display: "flex", gap: "var(--space-3)" }}>
                    {color ? (
                        <Badge tone={color === "B" ? "black" : "white"}>
                            {color === "B" ? "Black" : "White"}
                        </Badge>
                    ) : null}
                    {severity ? (
                        <Badge tone={severity}>
                            {SEVERITY_LABEL[severity]}
                        </Badge>
                    ) : null}
                </span>
            </div>
            <div
                className="ks-comment-panel__body"
                role="status"
                aria-live="polite"
            >
                {currentComment ? (
                    currentComment
                ) : (
                    <span className="ks-comment-panel__empty">
                        {currentMoveIndex === 0
                            ? "Starting position — no commentary for this turn."
                            : "No commentary was generated for this move."}
                    </span>
                )}
            </div>
        </aside>
    );
}
