export type GameMove = [string, [number, number] | null];

export function isValidMove(
    move: GameMove
): move is [string, [number, number]] {
    const [, coords] = move;
    return coords !== null;
}
