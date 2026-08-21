// The side panel is the extension's entire UI and was previously untested, even
// though `vitest.config.ts` has always matched `panel/**/*.test.ts`.
//
// These tests run against the real `panel.html`, imported with `?raw`, so an id
// renamed in the markup without being renamed in the code fails here rather than
// in a browser. `panel.ts` is imported for its exports; its only module-scope
// side effect is a `DOMContentLoaded` listener, which never fires in jsdom
// because the document is already complete.
import { beforeEach, describe, expect, it } from "vitest";

import { COMMENTARY_ERROR_MESSAGES } from "@shared/errors";

import {
    SCREEN_IDS,
    buildCard,
    decodeEmailFromToken,
    historyRow,
    initDemoScreen,
    showError,
    showScreen,
    waitingMessage,
} from "./panel";
import panelHtml from "./panel.html?raw";

/** Replace the document body with the real panel markup. */
function mountPanel(): void {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(panelHtml);
    document.body.innerHTML = body ? body[1] : panelHtml;
}

beforeEach(() => {
    mountPanel();
});

describe("screen routing", () => {
    it("has a matching element in panel.html for every screen id", () => {
        for (const id of SCREEN_IDS) {
            expect(document.getElementById(id), `#${id} is missing`).not.toBe(
                null
            );
        }
    });

    it("shows exactly one screen at a time", () => {
        showScreen("screen-commentary");

        const visible = SCREEN_IDS.filter(
            (id) => !document.getElementById(id)?.classList.contains("hidden")
        );
        expect(visible).toEqual(["screen-commentary"]);
    });

    it("hides the previous screen when another is shown", () => {
        showScreen("screen-config");
        showScreen("screen-error");

        expect(
            document
                .getElementById("screen-config")
                ?.classList.contains("hidden")
        ).toBe(true);
        expect(
            document
                .getElementById("screen-error")
                ?.classList.contains("hidden")
        ).toBe(false);
    });
});

describe("buildCard", () => {
    const moves: [string, [number, number] | null][] = [
        ["B", [3, 3]],
        ["W", [15, 15]],
        ["B", [2, 15]],
    ];

    it("names the severity rather than leaving it to the rail colour", () => {
        const card = buildCard(
            { turn: 1, comment: "…", winrate_delta: -18, color: "B" },
            moves
        );

        expect(card.className).toContain("card--blunder");
        expect(card.querySelector(".badge--blunder")?.textContent).toBe(
            "Blunder"
        );
    });

    it("puts the coordinate in the header, as the website does", () => {
        const card = buildCard(
            { turn: 2, comment: "…", winrate_delta: null, color: null },
            moves
        );

        expect(card.querySelector(".card-move")?.textContent).toBe(
            "Move 2 · Q16"
        );
    });

    it("names the colour rather than abbreviating it", () => {
        const card = buildCard(
            { turn: 1, comment: "…", winrate_delta: null, color: null },
            moves
        );

        expect(card.querySelector(".badge--black")?.textContent).toBe("Black");
    });

    it("shows the swing on its own line", () => {
        const card = buildCard(
            { turn: 1, comment: "…", winrate_delta: -18, color: "B" },
            moves
        );

        expect(card.querySelector(".card-stats")?.textContent).toBe(
            "Win rate −18%"
        );
    });

    it("reads the colour from the move list, not turn parity", () => {
        // Turn 2 is White here; a handicap game would invert naive parity.
        const card = buildCard(
            { turn: 2, comment: "…", winrate_delta: null, color: null },
            moves
        );

        expect(card.querySelector(".badge--white")).not.toBe(null);
    });

    it("renders the comment text verbatim", () => {
        const card = buildCard(
            {
                turn: 3,
                comment: "White's R16 threatened the weak group.",
                winrate_delta: null,
                color: null,
            },
            moves
        );

        expect(card.querySelector(".card-text")?.textContent).toBe(
            "White's R16 threatened the weak group."
        );
    });

    it("omits the win-rate line when the swing is unknown", () => {
        const card = buildCard(
            { turn: 1, comment: "…", winrate_delta: null, color: null },
            moves
        );

        expect(card.querySelector(".card-stats")).toBe(null);
        // The colour and severity labels are always there.
        expect(card.querySelectorAll(".badge")).toHaveLength(2);
    });
});

describe("showError", () => {
    // The panel used to show `detail` in preference to its own copy, which meant
    // its message table never fired and raw sgfmill exceptions reached the user.
    it("shows the client's copy rather than server prose", () => {
        showError({
            code: "invalid_sgf",
            detail: "Could not parse the SGF file: unexpected token at byte 12.",
            retryAfter: null,
        });

        expect(document.getElementById("error-msg")?.textContent).toBe(
            COMMENTARY_ERROR_MESSAGES.invalid_sgf
        );
    });

    it("explains a failure that arrived with no detail at all", () => {
        showError({ code: "katago_unavailable", detail: "", retryAfter: null });

        expect(document.getElementById("error-msg")?.textContent).toBe(
            COMMENTARY_ERROR_MESSAGES.katago_unavailable
        );
    });

    // Retrying a 409 earns the same 409.
    it("does not offer a retry while another run holds the slot", () => {
        showError({
            code: "job_already_running",
            detail: "",
            retryAfter: null,
        });

        expect(document.getElementById("btn-retry")?.textContent).toBe("Back");
    });

    it("names the wait when the backend supplied retry_after", () => {
        showError({
            code: "upstream_rate_limited",
            detail: "Rate limited.",
            retryAfter: 30,
        });

        expect(document.getElementById("error-msg")?.textContent).toContain(
            "Try again in 30s"
        );
    });

    it("relabels the action button per failure", () => {
        showError({ code: "no_api_key", detail: "", retryAfter: null });
        expect(document.getElementById("btn-retry")?.textContent).toBe(
            "Add API key"
        );

        showError({ code: "session_expired", detail: "", retryAfter: null });
        expect(document.getElementById("btn-retry")?.textContent).toBe(
            "Log in again"
        );
    });

    it("switches to the error screen", () => {
        showError({ code: "internal_error", detail: "", retryAfter: null });

        expect(
            document
                .getElementById("screen-error")
                ?.classList.contains("hidden")
        ).toBe(false);
    });
});

describe("copy helpers", () => {
    it("explains every non-ready game state", () => {
        expect(
            waitingMessage({ state: "unfinished", gameId: 1, phase: "play" })
        ).toContain("still in progress");
        expect(
            waitingMessage({
                state: "unfinished",
                gameId: 1,
                phase: "stone removal",
            })
        ).toContain("being scored");
        expect(
            waitingMessage({
                state: "unavailable",
                gameId: 1,
                reason: "not-found",
            })
        ).toContain("could not be found");
        expect(
            waitingMessage({
                state: "unavailable",
                gameId: 1,
                reason: "forbidden",
            })
        ).toContain("private");
        expect(waitingMessage({ state: "offline", gameId: 1 })).toContain(
            "Could not reach online-go.com"
        );
    });

    it("reads the account email out of the JWT payload", () => {
        const payload = btoa(JSON.stringify({ email: "player@example.com" }))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");

        expect(decodeEmailFromToken(`header.${payload}.signature`)).toBe(
            "player@example.com"
        );
    });

    it("returns null rather than throwing on a token it cannot read", () => {
        expect(decodeEmailFromToken("not-a-jwt")).toBe(null);
        expect(decodeEmailFromToken("")).toBe(null);
    });
});

describe("the signed-out preview", () => {
    // It used to be static markup: "−12%" tagged card--mistake, when
    // severityForDelta calls anything at or below −10 a blunder. Rendering it
    // through buildCard means the preview cannot disagree with a real card.
    it("tiers the preview by the same rule a real card uses", () => {
        initDemoScreen();

        const card = document.querySelector("#demo-card .card");
        expect(card?.className).toContain("card--blunder");
        expect(card?.querySelector(".badge--blunder")?.textContent).toBe(
            "Blunder"
        );
        expect(card?.querySelector(".card-stats")?.textContent).toBe(
            "Win rate \u221212%"
        );
    });

    it("shows the move the way the rest of the product does", () => {
        initDemoScreen();

        expect(
            document.querySelector("#demo-card .card-move")?.textContent
        ).toBe("Move 31 · Q16");
        expect(
            document.querySelector("#demo-card .badge--black")?.textContent
        ).toBe("Black");
    });
});

describe("past reviews", () => {
    // Every review already lands in the website's History — the job path calls
    // _save_commentary exactly like the sync one — but the extension declared no
    // history endpoints at all, so a finished panel review became recoverable only
    // from the website, which the panel never mentioned either.
    it("summarises a review the way the website's history card does", () => {
        const row = historyRow({
            id: 7,
            board_size: 19,
            sgf_file_name: "ogs-65097807_annotated.sgf",
            language: "english",
            created_at: "2026-03-04T10:00:00Z",
            moves: [
                ["B", [3, 3]],
                ["W", [15, 15]],
            ],
            initial_stones: [],
            comment_count: 12,
        });

        expect(row.querySelector(".history-name")?.textContent).toBe(
            "ogs-65097807_annotated.sgf"
        );
        const meta = row.querySelector(".history-meta")?.textContent ?? "";
        expect(meta).toContain("19×19");
        expect(meta).toContain("2 moves");
        expect(meta).toContain("12 comments");
    });

    it("is a real button, so it is keyboard-reachable", () => {
        const row = historyRow({
            id: 1,
            board_size: 9,
            sgf_file_name: "x.sgf",
            language: "english",
            created_at: "2026-03-04T10:00:00Z",
            moves: [],
            initial_stones: [],
            comment_count: 0,
        });

        expect(row.tagName).toBe("BUTTON");
        expect(row).toHaveProperty("type", "button");
    });
});
