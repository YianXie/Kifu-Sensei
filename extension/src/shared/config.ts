import { makeEndpoints } from "@shared/endpoints";

import { OGS_ORIGIN } from "./constants";

// Base URL of the Kifu-Sensei backend. Mirrors the web app's convention so the
// extension talks to the same API (localhost in dev, VITE_API_URL in prod).
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// Base URL of the Kifu-Sensei web app, used by the side panel to open the
// login/register tabs. Vite picks the value from .env.development (dev server
// / `--mode development` builds) or .env.production (plain `npm run build`).
export const FRONTEND_URL =
    import.meta.env.VITE_FRONTEND_URL ?? "http://localhost:5173";

export const ENDPOINTS = {
    // Every Kifu-Sensei route, from the same factory the web app uses. The panel
    // does not call all of them, but declaring the full table is what lets the two
    // surfaces stay in step — the extension's own list used to omit the history
    // routes entirely, which is why the panel never grew a history screen.
    ...makeEndpoints(API_URL),

    // OGS is unauthenticated for finished games. The SGF endpoint answers 403
    // ("Sign in to download SGF of in-progress games") while a game is still being
    // played, which backs up the phase check on the metadata endpoint.
    ogsGame: (gameId: number) => `${OGS_ORIGIN}/api/v1/games/${gameId}`,
    ogsGameSgf: (gameId: number) => `${OGS_ORIGIN}/api/v1/games/${gameId}/sgf`,
} as const;
