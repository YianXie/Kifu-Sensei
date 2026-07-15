import { CommentPanel } from "website-template-frontend";

type Move = [string, [number, number] | null];

// A 19×19 opening sequence — enough moves for a realistic "Move X / N" count.
const MOVES: Move[] = [
    ["B", [3, 3]],
    ["W", [15, 15]],
    ["B", [15, 3]],
    ["W", [3, 15]],
    ["B", [9, 2]],
    ["W", [13, 2]],
    ["B", [12, 3]],
    ["W", [13, 3]],
    ["B", [12, 4]],
    ["W", [9, 16]],
    ["B", [5, 16]],
    ["W", [7, 15]],
];

export function WithCommentary() {
    return (
        <CommentPanel
            boardCanvasSize={420}
            moves={MOVES}
            currentMoveIndex={6}
            currentComment="A calm, territorial approach. Black's low pincer invites White to choose between the corner and the outside — either is playable, but taking the corner keeps the position simple and slightly favors Black's framework on the left."
        />
    );
}

export function StartingPosition() {
    return (
        <CommentPanel
            boardCanvasSize={420}
            moves={MOVES}
            currentMoveIndex={0}
            currentComment=""
        />
    );
}

export function UncommentedMove() {
    return (
        <CommentPanel
            boardCanvasSize={420}
            moves={MOVES}
            currentMoveIndex={3}
            currentComment=""
        />
    );
}
