// Types that belong to the extension alone.
//
// Everything describing the Kifu-Sensei API — the commentary shapes, the job
// shapes, the error codes — lives in `@shared/types`, which the web app compiles
// from the same source. Both used to keep their own copy and the two had drifted in
// membership and in optionality.

export interface ExtensionAuthObject {
    accessToken: string;
    refreshToken: string;
}

/**
 * The subset of `GET /api/v1/games/{id}` this extension reads.
 *
 * `ended` is null while a game is in progress. `gamedata.phase` is the authoritative
 * signal — `"play"` and `"stone removal"` both mean not finished.
 */
export interface OgsGameSummary {
    id: number;
    ended: string | null;
    width: number;
    height: number;
    handicap: number;
    disable_analysis: boolean;
    gamedata?: {
        phase?: "play" | "stone removal" | "finished";
        /**
         * Every move played. Handicap stones are in `initial_state`, not here, so the
         * length is the real move count — and the ceiling on how many comments are
         * worth asking for.
         */
        moves?: unknown[];
    };
}
