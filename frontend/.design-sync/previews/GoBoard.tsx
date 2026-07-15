import { GoBoard } from "website-template-frontend";

type Move = [string, [number, number] | null];

const noop = () => {};

// A 9×9 game: corner points, then a central fight down the right side.
const MOVES: Move[] = [
    ["B", [2, 2]],
    ["W", [6, 6]],
    ["B", [6, 2]],
    ["W", [2, 6]],
    ["B", [4, 4]],
    ["W", [4, 6]],
    ["B", [3, 5]],
    ["W", [3, 6]],
    ["B", [4, 5]],
    ["W", [5, 6]],
    ["B", [2, 4]],
    ["W", [6, 4]],
];

const COMMENTS: Record<number, string> = {
    4: "Black takes tengen — a bold, influence-first choice on the small board.",
    8: "The pushing battle down the right leaves White a little overconcentrated.",
};

export function Opening() {
    return (
        <GoBoard
            boardSize={9}
            boardCanvasSize={360}
            moves={MOVES}
            comments={COMMENTS}
            currentMoveIndex={5}
            onMoveChange={noop}
        />
    );
}

export function Midgame() {
    return (
        <GoBoard
            boardSize={9}
            boardCanvasSize={360}
            moves={MOVES}
            comments={COMMENTS}
            currentMoveIndex={MOVES.length - 1}
            onMoveChange={noop}
        />
    );
}
