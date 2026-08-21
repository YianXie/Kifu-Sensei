import type { ReactNode } from "react";

import {
    COLOR_LABELS,
    type CommentarySeverity,
    SEVERITY_LABELS,
    formatDelta,
} from "@shared/commentary";

import { Badge } from "@/components/ui";

/** One commented move in a scrollable list — the extension panel's card. */
export default function CommentaryCard({
    move,
    coordinate,
    color = "B",
    severity = "notable",
    winRateDelta,
    children,
    onClick,
    className = "",
}: {
    move: number;
    coordinate?: string;
    color?: "B" | "W";
    severity?: CommentarySeverity;
    /** Win-rate change in percentage points, from the mover's perspective. */
    winRateDelta?: number | null;
    children?: ReactNode;
    onClick?: () => void;
    className?: string;
}) {
    const cls = `ks-commentary ks-commentary--${severity}${
        onClick ? " ks-commentary--interactive" : ""
    } ${className}`.trim();

    const inner = (
        <>
            <header className="ks-commentary__header">
                <span className="ks-commentary__move">
                    Move {move}
                    {coordinate ? ` · ${coordinate}` : ""}
                </span>
                <span className="ks-commentary__badges">
                    <Badge tone={color === "B" ? "black" : "white"}>
                        {COLOR_LABELS[color]}
                    </Badge>
                    <Badge tone={severity}>{SEVERITY_LABELS[severity]}</Badge>
                </span>
            </header>
            <div className="ks-commentary__body">{children}</div>
            {winRateDelta != null ? (
                <div className="ks-commentary__stats">
                    <span>Win rate {formatDelta(winRateDelta)}</span>
                </div>
            ) : null}
        </>
    );

    // Clickable cards jump the board to that move, so they have to be real
    // buttons — keyboard-reachable, not a div with an onClick.
    if (onClick) {
        return (
            <button type="button" className={cls} onClick={onClick}>
                {inner}
            </button>
        );
    }
    return <article className={cls}>{inner}</article>;
}
