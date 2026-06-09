/**
 * panel.ts — Kifu-Sensei Side Panel
 *
 * Controls all screen transitions and data-fetching logic for the Chrome
 * Side Panel. Four screens map to the three auth states plus the generating
 * and commentary display sub-states:
 *
 *   UNAUTHENTICATED  → "demo"
 *   AUTH_NO_KEY      → "api-key"  (or "generating" if trial credits available)
 *   READY            → "generating" → "commentary"
 */

import type {
    GenerateCommentaryResponse,
    CommentaryItem,
    ExtensionMessage,
} from "../shared/types";
import { AuthStates } from "../shared/types";
import { deriveAuthState } from "../shared/auth";
import {
    fetchOgsSgf,
    generateCommentary,
    saveClaudeApiKey,
} from "../shared/api";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Screen =
    | "demo"
    | "api-key"
    | "generating"
    | "commentary"
    | "error"
    | "waiting";

let currentGameId: number | null = null;
let lastCommentary: GenerateCommentaryResponse | null = null;
let commentaryTimestamp: number | null = null;
let progressInterval: ReturnType<typeof setInterval> | null = null;
let simulatedProgress = 0;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function $<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function showScreen(screen: Screen): void {
    const all: Screen[] = [
        "demo",
        "api-key",
        "generating",
        "commentary",
        "error",
        "waiting",
    ];
    for (const s of all) {
        $(`screen-${s}`)?.classList.toggle("hidden", s !== screen);
    }
}

// ---------------------------------------------------------------------------
// Screen: Demo (unauthenticated)
// ---------------------------------------------------------------------------

function initDemoScreen(): void {
    $("btn-register").addEventListener("click", () => {
        const params = new URLSearchParams({
            source: "extension",
            return_to: "extension",
        });
        if (currentGameId !== null)
            params.set("game_id", String(currentGameId));
        chrome.tabs.create({
            url: `https://kifu-sensei.ai/register?${params}`,
        });
    });

    $("btn-sign-in").addEventListener("click", () => {
        const params = new URLSearchParams({
            source: "extension",
            return_to: "extension",
        });
        if (currentGameId !== null)
            params.set("game_id", String(currentGameId));
        chrome.tabs.create({ url: `https://kifu-sensei.ai/login?${params}` });
    });
}

// ---------------------------------------------------------------------------
// Screen: API Key
// ---------------------------------------------------------------------------

function initApiKeyScreen(): void {
    const input = $<HTMLInputElement>("input-api-key");
    const saveBtn = $<HTMLButtonElement>("btn-save-key");
    const hint = $("key-valid-hint");
    const errEl = $("apikey-error");

    $("accordion-toggle").addEventListener("click", () => {
        const body = $("accordion-body");
        const chevron = $("accordion-chevron");
        const wasOpen = !body.classList.contains("hidden");
        body.classList.toggle("hidden", wasOpen);
        chevron.classList.toggle("accordion-chevron--open", !wasOpen);
    });

    input.addEventListener("input", () => {
        const v = input.value.trim();
        const valid = v.startsWith("sk-ant-") && v.length > 20;
        saveBtn.disabled = !valid;
        hint.classList.toggle("hidden", !valid);
        input.classList.toggle("field-input--valid", valid);
        errEl.classList.add("hidden");
    });

    saveBtn.addEventListener("click", () => {
        void handleSaveKey();
    });

    async function handleSaveKey(): Promise<void> {
        const key = input.value.trim();
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        errEl.classList.add("hidden");

        try {
            await saveClaudeApiKey(key);
            if (currentGameId !== null) {
                await startGeneration(currentGameId);
            } else {
                showScreen("waiting");
            }
        } catch (err) {
            errEl.textContent =
                err instanceof Error ? err.message : "Failed to save API key.";
            errEl.classList.remove("hidden");
            saveBtn.disabled = false;
            saveBtn.textContent = "Save & Generate";
        }
    }
}

// ---------------------------------------------------------------------------
// Screen: Generating — progress simulation
// ---------------------------------------------------------------------------

function startFakeProgress(): void {
    simulatedProgress = 0;
    updateProgressUI(0);

    // S-curve: quick initial gain, then decelerates and stalls below 88%
    // so the actual API response always delivers the satisfying jump to 100%.
    progressInterval = setInterval(() => {
        const headroom = 88 - simulatedProgress;
        const increment = Math.max(0.3, headroom * 0.025);
        simulatedProgress = Math.min(88, simulatedProgress + increment);
        updateProgressUI(simulatedProgress);
    }, 800);
}

function stopFakeProgress(): void {
    if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function updateProgressUI(pct: number): void {
    $("progress-fill").style.width = `${pct}%`;

    const move = Math.round((pct / 100) * 20);
    $("gen-subtitle").textContent = `Move ${move} of 20 key moves`;

    if (move > 0) {
        const player = move % 2 === 0 ? "White" : "Black";
        $("gen-current").textContent = `Move ${move} • ${player}`;
    }

    // Show first-result preview card once we're past 30%
    $("gen-first-result").classList.toggle("hidden", pct < 30);
}

// ---------------------------------------------------------------------------
// Screen: Generating — full flow
// ---------------------------------------------------------------------------

async function startGeneration(gameId: number): Promise<void> {
    showScreen("generating");
    startFakeProgress();

    try {
        const sgf = await fetchOgsSgf(gameId);
        const result = await generateCommentary(sgf, gameId);

        stopFakeProgress();
        updateProgressUI(100);

        lastCommentary = result;
        commentaryTimestamp = Date.now();

        // Brief pause at 100% so the user sees the bar fill before transition.
        setTimeout(() => {
            renderCommentary(result);
            showScreen("commentary");
        }, 400);
    } catch (err) {
        stopFakeProgress();
        const msg =
            err instanceof Error
                ? err.message
                : "Failed to generate commentary.";

        // API-key-related errors redirect to the key-entry screen.
        if (/api.?key|claude|sk-ant/i.test(msg)) {
            showScreen("api-key");
        } else {
            $("error-msg").textContent = msg;
            showScreen("error");
        }
    }
}

// ---------------------------------------------------------------------------
// Screen: Commentary — rendering
// ---------------------------------------------------------------------------

function parseDeltaPercent(comment: string): number | null {
    // Attempt to extract a negative winrate swing Claude may embed in the text,
    // e.g. "−18%" or "-18 percent" or "winrate dropped 18%".
    const m = comment.match(/[−\-](\d{1,2}(?:\.\d+)?)\s*%/);
    return m ? -parseFloat(m[1]) : null;
}

function getSeverity(
    delta: number | null,
    rank: number
): "blunder" | "mistake" | "notable" {
    if (delta !== null) {
        if (delta <= -15) return "blunder";
        if (delta <= -5) return "mistake";
        return "notable";
    }
    // Fallback: worst 20% are blunders, next 30% mistakes, rest notable.
    if (rank < 0.2) return "blunder";
    if (rank < 0.5) return "mistake";
    return "notable";
}

function buildCard(
    item: CommentaryItem,
    player: "B" | "W",
    severity: "blunder" | "mistake" | "notable"
): HTMLElement {
    const card = document.createElement("div");
    card.className = `card card--${severity}`;

    // Header
    const header = document.createElement("div");
    header.className = "card-header";

    const moveLabel = document.createElement("span");
    moveLabel.className = "card-move";
    moveLabel.textContent = `Move ${item.turn}`;

    const badges = document.createElement("div");
    badges.className = "card-badges";

    const playerBadge = document.createElement("span");
    playerBadge.className = `badge badge--${player === "B" ? "black" : "white"}`;
    playerBadge.textContent = player;
    badges.appendChild(playerBadge);

    header.appendChild(moveLabel);
    header.appendChild(badges);

    // Body
    const body = document.createElement("div");
    body.className = "card-body";

    const text = document.createElement("p");
    text.className = "card-text";
    // Ensure the comment is always shown with typographic quotes.
    const trimmed = item.comment.replace(/^[""]|[""]$/g, "").trim();
    text.textContent = `"${trimmed}"`;

    body.appendChild(text);
    card.appendChild(header);
    card.appendChild(body);
    return card;
}

function renderCommentary(data: GenerateCommentaryResponse): void {
    const list = $("commentary-list");
    list.innerHTML = "";

    const count = data.comments.length;
    $("commentary-count").textContent =
        `${count} key move${count !== 1 ? "s" : ""} analysed`;

    // Display in chronological order; severity is based on winrate magnitude.
    const sorted = [...data.comments].sort((a, b) => a.turn - b.turn);

    sorted.forEach((item, i) => {
        const moveEntry = data.moves[item.turn - 1];
        const player: "B" | "W" = moveEntry?.[0] === "W" ? "W" : "B";
        const delta = parseDeltaPercent(item.comment);
        const severity = getSeverity(delta, i / sorted.length);
        list.appendChild(buildCard(item, player, severity));
    });

    // Footer timestamp
    if (commentaryTimestamp !== null) {
        const secsAgo = Math.floor((Date.now() - commentaryTimestamp) / 1000);
        $("commentary-age").textContent =
            secsAgo < 60
                ? "Analysed just now"
                : `Analysed ${Math.round(secsAgo / 60)} minute${Math.round(secsAgo / 60) !== 1 ? "s" : ""} ago`;
    }
}

// ---------------------------------------------------------------------------
// Screen: Commentary controls
// ---------------------------------------------------------------------------

function initCommentaryControls(): void {
    $("btn-regenerate").addEventListener("click", () => {
        if (currentGameId !== null) void startGeneration(currentGameId);
    });
}

// ---------------------------------------------------------------------------
// Screen: Error
// ---------------------------------------------------------------------------

function initErrorScreen(): void {
    $("btn-retry").addEventListener("click", () => {
        if (currentGameId !== null) {
            void startGeneration(currentGameId);
        } else {
            void deriveAuthState().then(showInitialScreen);
        }
    });
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function initHeader(): void {
    $("btn-close").addEventListener("click", () => {
        window.close();
    });
}

// ---------------------------------------------------------------------------
// Screen routing
// ---------------------------------------------------------------------------

function showInitialScreen(authState: string): void {
    if (authState === AuthStates.UNAUTHENTICATED) {
        showScreen("demo");
        return;
    }

    if (authState === AuthStates.AUTH_NO_KEY) {
        // If we have a pending game we'll attempt generation (server handles
        // trial credits); on API-key error the catch block sends to "api-key".
        if (currentGameId !== null) {
            void startGeneration(currentGameId);
        } else {
            showScreen("api-key");
        }
        return;
    }

    // READY
    if (currentGameId !== null) {
        void startGeneration(currentGameId);
    } else if (lastCommentary !== null) {
        renderCommentary(lastCommentary);
        showScreen("commentary");
    } else {
        showScreen("waiting");
    }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

function listenForMessages(): void {
    chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
        if (message.type === "GAME_CONTEXT") {
            const newId = message.payload.gameId;
            if (newId === currentGameId) return; // already handling this game

            currentGameId = newId;

            void deriveAuthState().then((authState) => {
                if (authState === AuthStates.UNAUTHENTICATED) {
                    // Update the gameId used in the register/sign-in links,
                    // but keep showing the demo screen.
                    showScreen("demo");
                } else {
                    // AUTH_NO_KEY or READY — attempt generation regardless;
                    // the server decides whether trial credits cover it.
                    void startGeneration(newId);
                }
            });
        }

        if (message.type === "AUTH_STATE_CHANGED") {
            void deriveAuthState().then(showInitialScreen);
        }
    });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
    initHeader();
    initDemoScreen();
    initApiKeyScreen();
    initCommentaryControls();
    initErrorScreen();
    listenForMessages();

    const storage = await chrome.storage.local.get(["pending_game_id"]);
    const pendingId = storage.pending_game_id as number | undefined;

    if (pendingId !== undefined) {
        currentGameId = pendingId;
        // Consume it so a reload of the panel doesn't re-trigger generation.
        await chrome.storage.local.remove("pending_game_id");
    }

    const authState = await deriveAuthState();
    showInitialScreen(authState);
}

document.addEventListener("DOMContentLoaded", () => {
    void init();
});
