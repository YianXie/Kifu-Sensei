// Reading a game off online-go.com, and deciding whether it may be reviewed.
//
// Both calls here must be made from an extension context (the side panel or the
// service worker), never a content script — see the note in `api.ts`. `online-go.com`
// is in `host_permissions`, so extension pages reach it without CORS.

import { ENDPOINTS } from "./config";
import { OGS_ORIGIN } from "./constants";
import type { OgsGameSummary } from "./types";

/** OGS answers these in well under a second; a slow one is a failure, not a wait. */
const OGS_TIMEOUT_MS = 10_000;

/**
 * Game pages, and only game pages:
 *
 *     /game/65097807          /game/view/65097807          /game/65097807/42
 *
 * `/review/…` and `/demo/…` render through the same React view but are not games, and
 * `/game/:id/embed` is an iframe target — none of them match, because the optional
 * trailing segment must be a move number.
 */
const GAME_PATH = /^\/game\/(?:view\/)?(\d+)(?:\/\d+)?\/?$/;

/** Extract an OGS game id from a tab URL, or null if it is not a game page. */
export function parseOgsGameId(url: string | undefined): number | null {
    if (!url) {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.origin !== OGS_ORIGIN) {
        return null;
    }
    const match = GAME_PATH.exec(parsed.pathname);
    if (match === null) {
        return null;
    }
    const gameId = Number(match[1]);
    return Number.isSafeInteger(gameId) && gameId > 0 ? gameId : null;
}

export type OgsGameCheck =
    /** Finished, and safe to review. */
    | { state: "ready"; gameId: number; summary: OgsGameSummary }
    /** The tab is not on an OGS game page. */
    | { state: "no-game" }
    /** A real game, but still being played or scored. */
    | { state: "unfinished"; gameId: number; phase: string }
    /** OGS answered, but not with a game we can use. */
    | {
          state: "unavailable";
          gameId: number;
          reason: "not-found" | "forbidden" | "malformed";
      }
    /** OGS could not be reached at all. */
    | { state: "offline"; gameId: number };

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OGS_TIMEOUT_MS);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Decide whether a game may be reviewed.
 *
 * This is the first of two guards against ever activating on a live game. It reads
 * server truth rather than scraping the page: `gamedata.phase` is `"play"` while the
 * game is running, `"stone removal"` while it is being scored, and `"finished"` only
 * once it is over; `ended` is null until then.
 *
 * Both signals are required. If OGS ever stops sending `phase`, this reports
 * `malformed` and the panel stays inert — failing closed, because activating on a
 * game still in progress is the one thing that must not happen.
 *
 * The second guard is in {@link fetchOgsSgf}: the SGF endpoint itself answers 403 for
 * a game in progress, so a game that slipped past this check still cannot be reviewed.
 */
export async function checkOgsGame(
    url: string | undefined
): Promise<OgsGameCheck> {
    const gameId = parseOgsGameId(url);
    if (gameId === null) {
        return { state: "no-game" };
    }

    let response: Response;
    try {
        response = await fetchWithTimeout(ENDPOINTS.ogsGame(gameId));
    } catch (error) {
        console.warn("[Kifu-Sensei] Could not reach OGS:", error);
        return { state: "offline", gameId };
    }

    if (response.status === 404) {
        return { state: "unavailable", gameId, reason: "not-found" };
    }
    if (response.status === 403 || response.status === 401) {
        return { state: "unavailable", gameId, reason: "forbidden" };
    }
    if (!response.ok) {
        return { state: "offline", gameId };
    }

    let summary: OgsGameSummary;
    try {
        summary = (await response.json()) as OgsGameSummary;
    } catch (error) {
        console.warn("[Kifu-Sensei] Malformed OGS game payload:", error);
        return { state: "unavailable", gameId, reason: "malformed" };
    }

    const phase = summary.gamedata?.phase;
    if (phase === undefined) {
        return { state: "unavailable", gameId, reason: "malformed" };
    }
    if (phase !== "finished" || summary.ended === null) {
        return { state: "unfinished", gameId, phase };
    }

    return { state: "ready", gameId, summary };
}

export type OgsSgfResult =
    | { ok: true; sgf: string }
    | { ok: false; reason: "unfinished" | "not-found" | "offline" | "empty" };

/**
 * Download a finished game's SGF.
 *
 * The second live-game guard: OGS answers 403 "Sign in to download SGF of in-progress
 * games" for anything still being played, so this cannot return a live game's record
 * even if the phase check were bypassed. Analysis-disabled games are refused the same
 * way.
 */
export async function fetchOgsSgf(gameId: number): Promise<OgsSgfResult> {
    let response: Response;
    try {
        response = await fetchWithTimeout(ENDPOINTS.ogsGameSgf(gameId));
    } catch (error) {
        console.warn("[Kifu-Sensei] Could not download SGF:", error);
        return { ok: false, reason: "offline" };
    }

    if (response.status === 403 || response.status === 401) {
        return { ok: false, reason: "unfinished" };
    }
    if (response.status === 404) {
        return { ok: false, reason: "not-found" };
    }
    if (!response.ok) {
        return { ok: false, reason: "offline" };
    }

    const sgf = await response.text();
    // The backend enforces min_length=1 on sgf_content and will reject an empty body
    // with a validation error; catching it here gives a better message.
    if (!sgf.trim().startsWith("(")) {
        return { ok: false, reason: "empty" };
    }
    return { ok: true, sgf };
}
