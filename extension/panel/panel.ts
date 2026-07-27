import {
    authedFetch,
    clearStoredAuth,
    getCurrentAuth,
    isAuthObject,
    readErrorResponse,
    setCurrentAuth,
} from "../src/shared/api";
import { ENDPOINTS, FRONTEND_URL } from "../src/shared/config";
import {
    AUTH_STORAGE_KEY,
    CONFIG_STORAGE_KEY,
    JOB_SESSION_KEY,
    OGS_GAMES_URL,
    REVOKED_AUTH_KEY,
} from "../src/shared/constants";
import {
    CLAUDE_MODELS,
    CLAUDE_MODEL_LABELS,
    COMMENTARY_LANGUAGES,
    COMMENTARY_LANGUAGE_LABELS,
    CUSTOM_INSTRUCTION_MAX,
    DEFAULT_COMMENTARY_CONFIG,
    MAX_TOKEN_MAX,
    MAX_TOKEN_MIN,
    NUM_COMMENTS_MAX,
    NUM_COMMENTS_MIN,
    clampCommentaryConfig,
    colorForTurn,
    formatDelta,
    readCommentaryConfig,
    severityForDelta,
    type ClaudeModel,
    type CommentaryConfig,
    type CommentaryLanguage,
} from "../src/shared/commentary";
import { readJob, type StoredJob } from "../src/shared/jobs";
import { checkOgsGame, type OgsGameCheck } from "../src/shared/ogs";
import type {
    CommentaryItem,
    CommentaryResponse,
    ExtensionAuthObject,
    GameMove,
    PanelErrorCode,
} from "../src/shared/types";

// Frontend origins where the website may hold a stale extension_auth entry.
// Wildcarded because production serves the app from www — the bare apex only
// redirects there — and `*.` also covers the apex itself.
const FRONTEND_MATCHES = [
    "http://localhost:5173/*",
    "https://*.kifu-sensei.ai/*",
];

// Every top-level screen id, so we can flip to exactly one at a time.
const SCREEN_IDS = [
    "screen-demo",
    "screen-welcome",
    "screen-api-key",
    "screen-key-saved",
    "screen-config",
    "screen-generating",
    "screen-commentary",
    "screen-error",
    "screen-waiting",
] as const;

// Anthropic keys look like `sk-ant-api03-…`. Used only to show the reassuring
// format hint — the real check is the backend accepting the key.
const API_KEY_HINT_PATTERN = /^sk-ant-\S{16,}$/;

type ScreenId = (typeof SCREEN_IDS)[number];

let currentScreen: ScreenId | null = null;

// Guards against a slow game check overwriting a newer one: tab switches and SPA
// navigations can fire faster than OGS answers.
let gameCheckToken = 0;

// The game the panel is currently showing, so a run that belongs to a different game
// does not hijack the view.
let activeGameId: number | null = null;

function showScreen(id: ScreenId): void {
    currentScreen = id;
    for (const screenId of SCREEN_IDS) {
        document
            .getElementById(screenId)
            ?.classList.toggle("hidden", screenId !== id);
    }
}

// Best-effort extraction of the account email from the JWT payload so the
// welcome screen can greet the user. Never throws — a missing/odd token just
// yields null and the email line stays hidden.
function decodeEmailFromToken(accessToken: string): string | null {
    try {
        const payload = accessToken.split(".")[1];
        if (!payload) {
            return null;
        }
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(
            base64.length + ((4 - (base64.length % 4)) % 4),
            "="
        );
        const claims = JSON.parse(atob(padded)) as { email?: unknown };
        return typeof claims.email === "string" ? claims.email : null;
    } catch {
        return null;
    }
}

const WELCOME_LEAD_DEFAULT =
    "Your account is connected. Open a finished game and let Kifu-Sensei turn the key moments into plain-language commentary.";

function renderWelcome(auth: ExtensionAuthObject, game?: OgsGameCheck): void {
    const leadEl = document.getElementById("welcome-lead");
    if (leadEl) {
        leadEl.textContent =
            game?.state === "ready"
                ? `Game ${game.gameId} has finished and is ready to review.`
                : WELCOME_LEAD_DEFAULT;
    }
    const emailEl = document.getElementById("welcome-email");
    const email = decodeEmailFromToken(auth.accessToken);
    if (emailEl) {
        if (email) {
            emailEl.textContent = email;
            emailEl.classList.remove("hidden");
        } else {
            emailEl.textContent = "";
            emailEl.classList.add("hidden");
        }
    }
    showScreen("screen-welcome");
}

/**
 * Copy for every state that is *not* ready to review.
 *
 * `ready` is excluded from the parameter type and there is no `default`, so adding a
 * state to `OgsGameCheck` without giving it wording here is a compile error rather
 * than a silent fall-through to generic text.
 */
function waitingMessage(
    check: Exclude<OgsGameCheck, { state: "ready" } | { state: "no-game" }>
): string {
    switch (check.state) {
        case "unfinished":
            return check.phase === "stone removal"
                ? "This game is being scored. Kifu-Sensei can review it once it finishes."
                : "This game is still in progress. Kifu-Sensei can review it once it finishes.";
        case "unavailable":
            if (check.reason === "not-found") {
                return "That game could not be found on online-go.com.";
            }
            if (check.reason === "forbidden") {
                return "That game is private, so Kifu-Sensei cannot read it.";
            }
            return "Kifu-Sensei could not read this game's details from online-go.com.";
        case "offline":
            return "Could not reach online-go.com. Check your connection and try again.";
    }
}

function el<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

function fillSelect<T extends string>(
    select: HTMLSelectElement | null,
    values: readonly T[],
    labels: Record<T, string>
): void {
    if (select === null || select.options.length > 0) {
        return;
    }
    for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = labels[value];
        select.append(option);
    }
}

/** Read the config screen back into a value the backend will accept. */
function readConfigForm(): CommentaryConfig {
    return clampCommentaryConfig({
        model:
            (el<HTMLSelectElement>("config-model")?.value as ClaudeModel) ??
            DEFAULT_COMMENTARY_CONFIG.model,
        language:
            (el<HTMLSelectElement>("config-language")
                ?.value as CommentaryLanguage) ??
            DEFAULT_COMMENTARY_CONFIG.language,
        num_comments: Number(
            el<HTMLInputElement>("config-comments")?.value ??
                DEFAULT_COMMENTARY_CONFIG.num_comments
        ),
        max_token: Number(
            el<HTMLInputElement>("config-max-token")?.value ??
                DEFAULT_COMMENTARY_CONFIG.max_token
        ),
        custom_instruction:
            el<HTMLTextAreaElement>("config-instruction")?.value ?? "",
    });
}

function writeConfigForm(config: CommentaryConfig, moveCount: number): void {
    fillSelect(
        el<HTMLSelectElement>("config-model"),
        CLAUDE_MODELS,
        CLAUDE_MODEL_LABELS
    );
    fillSelect(
        el<HTMLSelectElement>("config-language"),
        COMMENTARY_LANGUAGES,
        COMMENTARY_LANGUAGE_LABELS
    );

    const model = el<HTMLSelectElement>("config-model");
    if (model) model.value = config.model;
    const language = el<HTMLSelectElement>("config-language");
    if (language) language.value = config.language;

    // There is no point asking for more comments than the game has moves.
    const maxComments =
        moveCount > 0
            ? Math.min(NUM_COMMENTS_MAX, moveCount)
            : NUM_COMMENTS_MAX;
    const comments = el<HTMLInputElement>("config-comments");
    if (comments) {
        comments.min = String(NUM_COMMENTS_MIN);
        comments.max = String(maxComments);
        comments.value = String(Math.min(config.num_comments, maxComments));
    }
    const hint = el("config-comments-hint");
    if (hint) {
        hint.textContent =
            moveCount > 0
                ? `1–${maxComments} (this game has ${moveCount} moves).`
                : `1–${NUM_COMMENTS_MAX}.`;
    }

    const maxToken = el<HTMLInputElement>("config-max-token");
    if (maxToken) {
        maxToken.min = String(MAX_TOKEN_MIN);
        maxToken.max = String(MAX_TOKEN_MAX);
        maxToken.value = String(config.max_token);
    }

    const instruction = el<HTMLTextAreaElement>("config-instruction");
    if (instruction) instruction.value = config.custom_instruction;
    syncInstructionCount();
    el("config-error")?.classList.add("hidden");
}

function syncInstructionCount(): void {
    const used =
        el<HTMLTextAreaElement>("config-instruction")?.value.length ?? 0;
    const counter = el("config-instruction-count");
    if (counter) {
        counter.textContent = `${used}/${CUSTOM_INSTRUCTION_MAX}`;
    }
}

/**
 * Show the config screen for a finished game.
 *
 * Defaults come from the account's saved preferences, then the last config used in
 * this browser, both run through the shared validator — a preference saved before the
 * model IDs were corrected would otherwise be rejected by the backend.
 */
async function showConfigScreen(
    game: Extract<OgsGameCheck, { state: "ready" }>
): Promise<void> {
    const heading = el("config-game");
    if (heading) {
        heading.textContent = `Game ${game.gameId} · ${game.summary.width}×${game.summary.height}${
            game.summary.handicap > 0
                ? ` · ${game.summary.handicap} stones`
                : ""
        }`;
    }

    const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
    const saved = stored[CONFIG_STORAGE_KEY] as CommentaryConfig | undefined;
    const config =
        saved !== undefined
            ? clampCommentaryConfig(
                  readCommentaryConfig({ commentary_config: saved })
              )
            : accountConfig;

    writeConfigForm(config, game.summary.gamedata?.moves?.length ?? 0);
    showScreen("screen-config");
}

// Defaults read from the account once per panel open.
let accountConfig: CommentaryConfig = DEFAULT_COMMENTARY_CONFIG;

/**
 * Render the signed-in landing for whatever the active tab is showing.
 *
 * The panel reads the tab URL rather than talking to a content script, so it also
 * works on a tab where the content script never ran.
 */
async function renderSignedIn(auth: ExtensionAuthObject): Promise<void> {
    const token = ++gameCheckToken;
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    const check = await checkOgsGame(tab?.url);
    if (token !== gameCheckToken) {
        return; // A newer check started while this one was in flight.
    }

    if (check.state === "no-game") {
        // Not looking at a game: the welcome screen is the signed-in home, and the
        // only route to sign-out.
        activeGameId = null;
        renderWelcome(auth);
        return;
    }
    activeGameId = check.gameId;

    if (check.state === "ready") {
        // A run already going for this game takes precedence over the form.
        const job = await readJob();
        if (job !== null && job.gameId === check.gameId) {
            renderJob(job);
            return;
        }
        await showConfigScreen(check);
        return;
    }

    const textEl = document.getElementById("waiting-text");
    if (textEl) {
        textEl.textContent = waitingMessage(check);
    }
    showScreen("screen-waiting");
}

// ── Running a review ────────────────────────────────────────────────────────

async function startGeneration(): Promise<void> {
    if (activeGameId === null) {
        return;
    }
    const config = readConfigForm();
    await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });

    // Paint the generating screen immediately; the worker's first storage write is a
    // network round-trip away.
    renderProgress({ done: 0, total: 0 });
    showScreen("screen-generating");

    const response = (await chrome.runtime.sendMessage({
        type: "start-commentary",
        gameId: activeGameId,
        config,
    })) as { ok: boolean } | undefined;

    if (response === undefined) {
        showError({
            code: "network",
            detail: "Kifu-Sensei could not start the review. Please try again.",
            retryAfter: null,
        });
    }
}

function renderProgress(progress: { done: number; total: number }): void {
    const subtitle = el("gen-subtitle");
    const fill = el("progress-fill");
    const findingIcon = el("gen-finding-icon");
    const writingStep = el("gen-writing-step");
    const writingIcon = el("gen-writing-icon");

    if (progress.total === 0) {
        // KataGo is still choosing the moves. There is genuinely nothing to
        // measure yet, so the bar stays empty rather than inventing motion.
        if (subtitle) subtitle.textContent = "Finding the key moments…";
        if (fill) fill.style.width = "0%";
        if (findingIcon) {
            findingIcon.textContent = "◷";
            findingIcon.className = "gen-step-icon gen-step-icon--spin";
        }
        writingStep?.classList.add("gen-step--pending");
        if (writingIcon) {
            writingIcon.textContent = "○";
            writingIcon.className = "gen-step-icon";
        }
        return;
    }

    if (subtitle) {
        subtitle.textContent = `Move ${progress.done} of ${progress.total} key moments`;
    }
    if (fill) {
        fill.style.width = `${Math.round((progress.done / progress.total) * 100)}%`;
    }
    if (findingIcon) {
        findingIcon.textContent = "✔";
        findingIcon.className = "gen-step-icon gen-step-icon--done";
    }
    writingStep?.classList.remove("gen-step--pending");
    if (writingIcon) {
        writingIcon.textContent = "◷";
        writingIcon.className = "gen-step-icon gen-step-icon--spin";
    }
}

function buildCard(item: CommentaryItem, moves: GameMove[]): HTMLElement {
    const severity = severityForDelta(item.winrate_delta);
    const colour = colorForTurn(moves, item.turn, item.color);

    const card = document.createElement("div");
    card.className = `card card--${severity}`;

    const header = document.createElement("div");
    header.className = "card-header";

    const move = document.createElement("span");
    move.className = "card-move";
    move.textContent = `Move ${item.turn}`;

    const badges = document.createElement("div");
    badges.className = "card-badges";

    const colourBadge = document.createElement("span");
    colourBadge.className = `badge badge--${colour === "B" ? "black" : "white"}`;
    colourBadge.textContent = colour;
    badges.append(colourBadge);

    const deltaText = formatDelta(item.winrate_delta);
    if (deltaText !== "") {
        const deltaBadge = document.createElement("span");
        deltaBadge.className = `badge badge--${severity}`;
        deltaBadge.textContent = deltaText;
        badges.append(deltaBadge);
    }

    header.append(move, badges);

    const body = document.createElement("div");
    body.className = "card-body";
    const text = document.createElement("p");
    text.className = "card-text";
    text.textContent = item.comment;
    body.append(text);

    card.append(header, body);
    return card;
}

function renderCommentary(result: CommentaryResponse): void {
    const list = el("commentary-list");
    if (list) {
        list.replaceChildren(
            ...[...result.comments]
                .sort((a, b) => a.turn - b.turn)
                .map((item) => buildCard(item, result.moves))
        );
    }

    const count = el("commentary-count");
    if (count) {
        const n = result.comments.length;
        count.textContent = `${n} comment${n === 1 ? "" : "s"}`;
    }

    const stats = el("commentary-stats");
    if (stats) {
        const parts: string[] = [];
        if (result.usage) {
            const total =
                result.usage.input_tokens + result.usage.output_tokens;
            parts.push(`${total.toLocaleString()} tokens`);
        }
        if (result.model) {
            parts.push(CLAUDE_MODEL_LABELS[result.model] ?? result.model);
        }
        stats.textContent = parts.join(" · ");
    }

    showScreen("screen-commentary");
}

/** What the error screen's primary button should do, per failure. */
type ErrorAction = "retry" | "api-key" | "sign-in";

function errorAction(code: PanelErrorCode | null): ErrorAction {
    if (code === "no_api_key") return "api-key";
    if (code === "session_expired") return "sign-in";
    return "retry";
}

const ERROR_MESSAGES: Record<PanelErrorCode, string> = {
    no_api_key:
        "Add your Claude API key to generate commentary. Kifu-Sensei uses your own key.",
    invalid_sgf:
        "Kifu-Sensei could not read this game's record. It may be an unsupported format.",
    upstream_rate_limited:
        "Anthropic is rate-limiting your API key. Please wait and try again.",
    upstream_auth_failed:
        "Anthropic rejected your API key. Check it under Settings on the website.",
    upstream_error: "Claude could not be reached. Please try again.",
    katago_unavailable:
        "The analysis engine is unavailable right now. Please try again shortly.",
    internal_error:
        "Something went wrong generating commentary. Please try again.",
    session_expired:
        "Your session expired. Sign in again on the Kifu-Sensei website.",
    network:
        "Could not reach Kifu-Sensei. Check your connection and try again.",
    timeout:
        "This review took too long and was stopped. Try again with fewer comments.",
    sgf_unavailable: "Could not download this game from online-go.com.",
};

let pendingErrorAction: ErrorAction = "retry";

function showError(error: {
    code: PanelErrorCode | null;
    detail: string;
    retryAfter: number | null;
}): void {
    let message =
        error.code !== null
            ? (ERROR_MESSAGES[error.code] ?? error.detail)
            : error.detail;
    if (error.code === "upstream_rate_limited" && error.retryAfter !== null) {
        message = `Anthropic is rate-limiting your API key. Try again in ${error.retryAfter}s.`;
    }

    const msgEl = el("error-msg");
    if (msgEl) msgEl.textContent = message;

    pendingErrorAction = errorAction(error.code);
    const retry = el<HTMLButtonElement>("btn-retry");
    if (retry) {
        retry.textContent =
            pendingErrorAction === "api-key"
                ? "Add API key"
                : pendingErrorAction === "sign-in"
                  ? "Sign in again"
                  : "Try Again";
    }
    showScreen("screen-error");
}

/** Map a stored job onto a screen. The panel is a pure view over this. */
function renderJob(job: StoredJob): void {
    if (job.status === "succeeded" && job.result !== null) {
        renderCommentary(job.result);
        return;
    }
    if (job.status === "failed") {
        showError(
            job.error ?? {
                code: "internal_error",
                detail: "Failed to generate commentary.",
                retryAfter: null,
            }
        );
        return;
    }
    renderProgress(job.progress);
    showScreen("screen-generating");
}

/**
 * Re-evaluate the active tab. Only redraws the two game-dependent screens, so a
 * navigation cannot yank the user out of the API-key flow.
 */
async function refreshGameState(): Promise<void> {
    if (
        currentScreen !== "screen-welcome" &&
        currentScreen !== "screen-waiting" &&
        currentScreen !== "screen-config"
    ) {
        return;
    }
    const auth = getCurrentAuth();
    if (auth === null) {
        return;
    }
    await renderSignedIn(auth);
}

// Drops the stored session and returns the panel to the signed-out screen.
async function handleDeadSession(): Promise<void> {
    await clearStoredAuth();
    showScreen("screen-demo");
}

// Reflect the current stored auth state into the panel. Signed-out users get
// the demo screen; signed-in users get the key-entry screen or the welcome
// screen depending on whether their account already has a Claude API key.
// Runs on every panel open, so the key state can't go stale between sessions.
async function syncAuthState(): Promise<void> {
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    if (!isAuthObject(auth)) {
        setCurrentAuth(null);
        showScreen("screen-demo");
        return;
    }
    setCurrentAuth(auth);

    const response = await authedFetch(ENDPOINTS.userSettings);
    if (response === null || !response.ok) {
        if (response?.status === 401) {
            await handleDeadSession();
            return;
        }
        // Backend unreachable or erroring: don't guess at the key state and
        // don't nag a user who may already have a key. Commentary is gated
        // server-side regardless, so the welcome screen is the safe landing.
        console.warn(
            "[Kifu-Sensei panel] Could not read user settings; assuming a key is set."
        );
        await renderSignedIn(auth);
        return;
    }

    let settings: {
        has_claude_api_key?: unknown;
        preferences?: Record<string, unknown>;
    };
    try {
        settings = (await response.json()) as typeof settings;
        accountConfig = readCommentaryConfig(settings.preferences);
    } catch (error) {
        console.error(
            "[Kifu-Sensei panel] Malformed settings response:",
            error
        );
        await renderSignedIn(auth);
        return;
    }

    if (settings.has_claude_api_key === true) {
        await renderSignedIn(auth);
    } else {
        showApiKeyScreen();
    }
}

function initHeader(): void {
    document.getElementById("btn-close")?.addEventListener("click", () => {
        window.close();
    });
}

function initDemoScreen(): void {
    document.getElementById("btn-register")?.addEventListener("click", () => {
        chrome.tabs.create({
            url: `${FRONTEND_URL}/register?source=extension`,
        });
    });
    document.getElementById("btn-login")?.addEventListener("click", () => {
        chrome.tabs.create({
            url: `${FRONTEND_URL}/login?source=extension`,
        });
    });
}

// Remove the website's stale extension_auth from every open frontend tab so it
// can't re-authenticate the extension after sign-out. Best-effort: tabs that
// aren't open now are covered by the content script's revoked-session check.
async function clearWebsiteAuth(): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({ url: FRONTEND_MATCHES });
        await Promise.all(
            tabs.map((tab) => {
                if (tab.id === undefined) {
                    return Promise.resolve();
                }
                return chrome.scripting
                    .executeScript({
                        target: { tabId: tab.id },
                        func: () => localStorage.removeItem("extension_auth"),
                    })
                    .catch((error) => {
                        console.warn(
                            "[Kifu-Sensei panel] Could not clear extension_auth on tab",
                            tab.id,
                            error
                        );
                    });
            })
        );
    } catch (error) {
        console.warn("[Kifu-Sensei panel] clearWebsiteAuth failed:", error);
    }
}

async function signOut(): Promise<void> {
    // Record the session being revoked so the content script won't re-adopt it
    // from any lingering website localStorage entry.
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    if (isAuthObject(auth)) {
        await chrome.storage.local.set({
            [REVOKED_AUTH_KEY]: auth.refreshToken,
        });
    }
    // Clearing the stored session flips the panel back to the demo screen via
    // the storage-change listener.
    await clearStoredAuth();
    await clearWebsiteAuth();
}

function initWelcomeScreen(): void {
    document.getElementById("btn-open-ogs")?.addEventListener("click", () => {
        chrome.tabs.create({ url: OGS_GAMES_URL });
    });
    document
        .getElementById("btn-signout")
        ?.addEventListener("click", () => void signOut());
}

function keyInput(): HTMLInputElement | null {
    return document.getElementById("input-api-key") as HTMLInputElement | null;
}

function saveKeyButton(): HTMLButtonElement | null {
    return document.getElementById("btn-save-key") as HTMLButtonElement | null;
}

function showApiKeyError(message: string): void {
    const errorEl = document.getElementById("apikey-error");
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove("hidden");
    }
}

function hideApiKeyError(): void {
    document.getElementById("apikey-error")?.classList.add("hidden");
}

// Mirror the typed key into the submit button and the format hint. The button
// only needs a non-empty key — the hint is the softer signal, so an unexpected
// key shape never hard-blocks a user whose key is actually fine.
function syncKeyFieldState(): void {
    const input = keyInput();
    if (input === null) {
        return;
    }
    const key = input.value.trim();
    const looksValid = API_KEY_HINT_PATTERN.test(key);

    const button = saveKeyButton();
    if (button) {
        button.disabled = key.length === 0;
    }
    input.classList.toggle("field-input--valid", looksValid);
    document
        .getElementById("key-valid-hint")
        ?.classList.toggle("hidden", !looksValid);
}

function showApiKeyScreen(): void {
    const input = keyInput();
    if (input) {
        input.value = "";
    }
    hideApiKeyError();
    syncKeyFieldState();
    showScreen("screen-api-key");
}

function setSavingKey(saving: boolean): void {
    const button = saveKeyButton();
    if (button === null) {
        return;
    }
    button.disabled = saving;
    button.textContent = saving ? "Saving…" : "Save & Continue";
}

async function saveApiKey(): Promise<void> {
    const input = keyInput();
    const key = input?.value.trim();
    if (!key) {
        return;
    }

    hideApiKeyError();
    setSavingKey(true);
    const response = await authedFetch(ENDPOINTS.claudeApiKey, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claude_api_key: key }),
    });
    setSavingKey(false);

    if (response === null) {
        showApiKeyError(
            "Could not reach Kifu-Sensei. Check your connection and try again."
        );
        syncKeyFieldState();
        return;
    }
    if (response.status === 401) {
        await handleDeadSession();
        return;
    }
    if (!response.ok) {
        const { detail } = await readErrorResponse(
            response,
            "Could not save your API key. Please try again."
        );
        showApiKeyError(detail);
        syncKeyFieldState();
        return;
    }

    // Saved — don't leave the plaintext key sitting in the DOM.
    if (input) {
        input.value = "";
    }
    syncKeyFieldState();
    showScreen("screen-key-saved");
}

function initApiKeyScreen(): void {
    keyInput()?.addEventListener("input", () => {
        hideApiKeyError();
        syncKeyFieldState();
    });
    keyInput()?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            void saveApiKey();
        }
    });
    saveKeyButton()?.addEventListener("click", () => void saveApiKey());

    document
        .getElementById("accordion-toggle")
        ?.addEventListener("click", () => {
            const body = document.getElementById("accordion-body");
            const isOpen = body?.classList.toggle("hidden") === false;
            document
                .getElementById("accordion-chevron")
                ?.classList.toggle("accordion-chevron--open", isOpen);
        });
}

function initConfigScreen(): void {
    el("btn-generate")?.addEventListener("click", () => void startGeneration());
    el("config-instruction")?.addEventListener("input", syncInstructionCount);
}

function initGeneratingScreen(): void {
    el("btn-cancel-generating")?.addEventListener("click", () => {
        void (async () => {
            await chrome.runtime.sendMessage({ type: "cancel-commentary" });
            await refreshAfterJobCleared();
        })();
    });
}

function initCommentaryScreen(): void {
    // Starts over from the config screen: the run is discarded and the game is
    // re-read. Phase 4 makes this reuse the cached record instead.
    el("btn-regenerate")?.addEventListener("click", () => {
        void (async () => {
            await chrome.runtime.sendMessage({ type: "cancel-commentary" });
            await refreshAfterJobCleared();
        })();
    });
}

function initErrorScreen(): void {
    el("btn-retry")?.addEventListener("click", () => {
        void (async () => {
            if (pendingErrorAction === "api-key") {
                showApiKeyScreen();
                return;
            }
            if (pendingErrorAction === "sign-in") {
                chrome.tabs.create({
                    url: `${FRONTEND_URL}/login?source=extension`,
                });
                return;
            }
            await chrome.runtime.sendMessage({ type: "cancel-commentary" });
            await refreshAfterJobCleared();
        })();
    });
    el("btn-error-back")?.addEventListener("click", () => {
        void (async () => {
            await chrome.runtime.sendMessage({ type: "cancel-commentary" });
            await refreshAfterJobCleared();
        })();
    });
}

/** Return to the config or waiting screen once a run has been discarded. */
async function refreshAfterJobCleared(): Promise<void> {
    const auth = getCurrentAuth();
    if (auth === null) {
        showScreen("screen-demo");
        return;
    }
    await renderSignedIn(auth);
}

/**
 * The panel renders whatever the worker last wrote. That is what lets it be closed
 * and reopened mid-run without losing anything.
 */
function watchJobState(): void {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "session" || !(JOB_SESSION_KEY in changes)) {
            return;
        }
        const job = changes[JOB_SESSION_KEY].newValue as StoredJob | undefined;
        if (job === undefined) {
            return;
        }
        // A run for a game the user has navigated away from keeps going, but must
        // not take over the view.
        if (activeGameId !== null && job.gameId !== activeGameId) {
            return;
        }
        renderJob(job);
    });
}

function initKeySavedScreen(): void {
    document
        .getElementById("btn-saved-open-ogs")
        ?.addEventListener("click", () => {
            chrome.tabs.create({ url: OGS_GAMES_URL });
        });
}

// Keep the panel in sync when auth is written/cleared elsewhere (e.g. the
// content script authenticates while this panel is open).
function watchAuthState(): void {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !(AUTH_STORAGE_KEY in changes)) {
            return;
        }
        const { newValue, oldValue } = changes[AUTH_STORAGE_KEY];
        if (!isAuthObject(newValue)) {
            setCurrentAuth(null);
            showScreen("screen-demo");
            return;
        }
        setCurrentAuth(newValue);
        // A token rotation (signed in both before and after) must not yank the
        // user out of the key-entry or key-saved screen, so only a fresh
        // sign-in re-runs the sync.
        if (!isAuthObject(oldValue)) {
            void syncAuthState();
        }
    });
}

function watchActiveTab(): void {
    chrome.tabs.onActivated.addListener(() => void refreshGameState());
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
        // OGS is a single-page app: moving between games fires onUpdated with a new
        // url and no page load, which is the only signal the panel gets.
        if (changeInfo.url !== undefined && tab.active) {
            void refreshGameState();
        }
    });
}

function init(): void {
    initHeader();
    initDemoScreen();
    initWelcomeScreen();
    initApiKeyScreen();
    initKeySavedScreen();
    initConfigScreen();
    initGeneratingScreen();
    initCommentaryScreen();
    initErrorScreen();
    watchAuthState();
    watchActiveTab();
    watchJobState();
    // A run may have been going while the panel was closed; make sure something is
    // still polling it.
    void chrome.runtime.sendMessage({ type: "resume-polling" });
    void syncAuthState();
}

document.addEventListener("DOMContentLoaded", init);
