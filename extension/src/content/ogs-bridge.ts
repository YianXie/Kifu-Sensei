/**
 * ogs-bridge.ts
 *
 * Pure data layer. Responsible for everything we need to *know* about the
 * current OGS game — parsing the game ID out of the URL, fetching game
 * metadata from the OGS REST API, and deciding whether it is safe to inject.
 *
 * This file has no knowledge of the DOM overlay or auth state. It just
 * answers questions about the game.
 */

const OGS_API_BASE = "https://online-go.com/api/v1";

/**
 * The subset of the OGS REST API game object we care about.
 * Full schema: https://apidocs.online-go.com
 */
export interface OGSGameData {
    id: number;
    /**
     * Lifecycle phase of the game. The values we care about:
     *   "finished"       — game is over, safe to overlay
     *   "play"           — game is in progress, must NOT overlay (cheating risk)
     *   "stone removal"  — end-game territory scoring, treat as live
     */
    phase: "finished" | "play" | "stone removal" | string;
    name: string;
    width: number;
    height: number;
    white_player: { id: number; username: string };
    black_player: { id: number; username: string };
    /**
     * OGS sets this flag on certain games (e.g. correspondence games still
     * in progress on a review board). We must respect it regardless of phase.
     */
    disable_analysis: boolean;
}

/**
 * Parses the OGS game ID from the current page URL.
 *
 * OGS game URLs follow the pattern:
 *   https://online-go.com/game/12345
 *   https://online-go.com/game/12345/something
 *
 * Returns null if the current URL does not match this pattern — e.g. if
 * the user is on a profile page, /learn, /observe, etc.
 */
export function getGameIdFromUrl(): number | null {
    const match = window.location.pathname.match(/^\/game\/(\d+)/);
    if (!match) return null;
    return parseInt(match[1], 10);
}

/**
 * Fetches game metadata from the OGS REST API for a given game ID.
 *
 * We use this to check `phase` and `disable_analysis` before injecting
 * anything. Making this a network call (rather than reading the DOM) means
 * we get authoritative data that hasn't been filtered or summarised by
 * OGS's React rendering layer.
 *
 * Returns null on any network or parse error — the caller should treat
 * null as "do not inject".
 */
export async function fetchGameData(
    gameId: number
): Promise<OGSGameData | null> {
    try {
        const response = await fetch(`${OGS_API_BASE}/games/${gameId}/`, {
            headers: { Accept: "application/json" },
        });

        if (!response.ok) {
            console.warn(
                `[Kifu-Sensei] OGS API returned ${response.status} for game ${gameId}.`
            );
            return null;
        }

        return (await response.json()) as OGSGameData;
    } catch (err) {
        // Network failure, CORS issue, or JSON parse error — treat as unknown
        console.warn(
            `[Kifu-Sensei] Failed to fetch game data for game ${gameId}:`,
            err
        );
        return null;
    }
}

/**
 * The single authoritative check that must pass before we inject anything.
 *
 * Per spec section 3.2 / 6.4, two conditions must BOTH be true:
 *   1. phase === "finished"        — the game is completely over
 *   2. disable_analysis === false  — OGS hasn't flagged this game as off-limits
 *
 * If either condition fails, we must not inject. This is not optional —
 * injecting AI commentary on a live game is a cheating vector and an
 * existential reputational risk for the platform.
 */
export function isSafeToInject(game: OGSGameData): boolean {
    return game.phase === "finished" && !game.disable_analysis;
}
