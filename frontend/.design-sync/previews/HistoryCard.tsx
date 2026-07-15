import { HistoryCard } from "website-template-frontend";

type Move = [string, [number, number] | null];

const noop = () => {};

const MOVES_19: Move[] = [
    ["B", [3, 3]], ["W", [15, 15]], ["B", [15, 3]], ["W", [3, 15]],
    ["B", [9, 2]], ["W", [13, 2]], ["B", [12, 3]], ["W", [13, 3]],
    ["B", [12, 4]], ["W", [9, 16]], ["B", [5, 16]], ["W", [7, 15]],
    ["B", [5, 14]], ["W", [2, 5]], ["B", [2, 4]], ["W", [3, 5]],
    ["B", [5, 2]], ["W", [16, 9]], ["B", [16, 12]], ["W", [15, 11]],
];

const MOVES_9: Move[] = [
    ["B", [2, 2]], ["W", [6, 6]], ["B", [6, 2]], ["W", [2, 6]],
    ["B", [4, 4]], ["W", [4, 6]], ["B", [3, 5]], ["W", [3, 6]],
];

const SGF = "(;FF[4]GM[1]SZ[19];B[dd];W[pp];B[pd];W[dp])";

export function English() {
    return (
        <HistoryCard
            commentary={{
                board_size: 19,
                sgf_file_name: "meijin-2024-game3.sgf",
                language: "english",
                moves: MOVES_19,
                initial_stones: [],
                comments: [
                    { turn: 8, comment: "The 3–3 invasion is timed well." },
                    { turn: 13, comment: "Black builds a double-wing framework." },
                    { turn: 18, comment: "White reduces before it grows too large." },
                ],
                annotated_sgf_content: SGF,
            }}
            onOpen={noop}
        />
    );
}

export function Japanese9x9() {
    return (
        <HistoryCard
            commentary={{
                board_size: 9,
                sgf_file_name: "9x9-teaching-game.sgf",
                language: "japanese",
                moves: MOVES_9,
                initial_stones: [],
                comments: [{ turn: 4, comment: "中央志向の布石。" }],
                annotated_sgf_content: "(;FF[4]GM[1]SZ[9];B[cc];W[gg])",
            }}
            onOpen={noop}
        />
    );
}
