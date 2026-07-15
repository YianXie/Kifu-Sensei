import { MiniBoardThumb } from "website-template-frontend";

type Move = [string, [number, number] | null];

const NINE: Move[] = [
    ["B", [2, 2]],
    ["W", [6, 6]],
    ["B", [6, 2]],
    ["W", [2, 6]],
    ["B", [4, 4]],
    ["W", [4, 6]],
    ["B", [3, 5]],
    ["W", [3, 6]],
];

const NINETEEN: Move[] = [
    ["B", [3, 3]],
    ["W", [15, 15]],
    ["B", [15, 3]],
    ["W", [3, 15]],
    ["B", [9, 2]],
    ["W", [13, 2]],
    ["B", [12, 3]],
    ["W", [13, 3]],
    ["B", [9, 16]],
    ["W", [5, 16]],
];

// Two-stone handicap on the 9×9 star points.
const HANDICAP: Move[] = [
    ["B", [2, 6]],
    ["B", [6, 2]],
];

export function NineByNine() {
    return <MiniBoardThumb boardSize={9} moves={NINE} size={120} />;
}

export function NineteenByNineteen() {
    return <MiniBoardThumb boardSize={19} moves={NINETEEN} size={120} />;
}

export function WithHandicap() {
    return (
        <MiniBoardThumb
            boardSize={9}
            moves={[["W", [4, 4]]]}
            initialStones={HANDICAP}
            size={120}
        />
    );
}
