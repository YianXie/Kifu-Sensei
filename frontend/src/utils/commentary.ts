import { GTP_LETTERS } from "@/constants/game/go";
import type { GameMove } from "@/types/game";

export type CommentarySeverity = "blunder" | "mistake" | "notable";

/**
 * Map a win-rate swing onto the card styling tiers.
 *
 * Thresholds live here rather than on the server: the tier is a display concern,
 * and baking it into the API would freeze it into every stored commentary.
 * `null`/`undefined` covers commentaries saved before `winrate_delta` existed.
 *
 * The extension keeps its own copy in `extension/src/shared/commentary.ts`
 * (separate build, no shared module) — change both together.
 */
export function severityForDelta(
    delta: number | null | undefined
): CommentarySeverity {
    if (delta === null || delta === undefined) {
        return "notable";
    }
    if (delta <= -10) {
        return "blunder";
    }
    if (delta <= -5) {
        return "mistake";
    }
    return "notable";
}

/**
 * Colour of the player who made a given move.
 *
 * Read from the move list, never inferred from turn parity: a handicap game puts
 * its stones in `initial_stones` and opens with White, so parity is inverted for
 * the whole game. `fallback` is the `color` field on the comment, which older
 * stored commentaries lack.
 */
export function colorForTurn(
    moves: GameMove[],
    turn: number,
    fallback?: "B" | "W" | null
): "B" | "W" {
    const fromMoves = moves[turn - 1]?.[0];
    if (fromMoves === "B" || fromMoves === "W") {
        return fromMoves;
    }
    return fallback === "B" || fallback === "W" ? fallback : "B";
}

/**
 * GTP coordinate of the stone played on `turn`, e.g. `"Q4"`. Empty for a pass,
 * or for a turn outside the game.
 */
export function coordinateForTurn(moves: GameMove[], turn: number): string {
    const coords = moves[turn - 1]?.[1];
    if (!coords) return "";
    const [row, col] = coords;
    return `${GTP_LETTERS[col] ?? col + 1}${row + 1}`;
}
