// Drives the injected button: what it says, and what a click does.
//
// Runs in the content script, so it never talks to the Kifu-Sensei backend directly —
// a content script's fetch carries the page's origin and the backend's CORS allowlist
// does not include online-go.com. It reads state from `chrome.storage.local` and asks
// the service worker to do anything privileged.
//
// Reading OGS's own API *is* fine from here: the content script is same-origin with it.

import {
    AUTH_STORAGE_KEY,
    JOB_STATUS_KEY,
    OGS_ORIGIN,
} from "../shared/constants";
import type { PublicJobStatus } from "../shared/jobs";
import { checkOgsGame, type OgsGameCheck } from "../shared/ogs";
import { createOgsButton, type ButtonKind } from "./ogs-button";
import { findMountPoint, watchForMount } from "./mount";

let game: OgsGameCheck = { state: "no-game" };
let button: ReturnType<typeof createOgsButton> | null = null;
/** Set when Chrome refused to open the panel, so the button can say what to do. */
let panelHint = false;

async function readSignedIn(): Promise<boolean> {
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const auth = stored[AUTH_STORAGE_KEY];
    return (
        typeof auth === "object" &&
        auth !== null &&
        typeof (auth as { accessToken?: unknown }).accessToken === "string"
    );
}

async function readJobStatus(): Promise<PublicJobStatus | null> {
    const stored = await chrome.storage.local.get(JOB_STATUS_KEY);
    return (stored[JOB_STATUS_KEY] as PublicJobStatus | undefined) ?? null;
}

async function render(): Promise<void> {
    // The button exists only on a game that can actually be reviewed. A live game
    // gets nothing at all — no button, no affordance, nothing to click.
    if (game.state !== "ready") {
        button?.destroy();
        button = null;
        return;
    }

    const container = findMountPoint();
    if (container === null) {
        return; // React has not built it yet; the watcher will call back.
    }

    if (button === null) {
        button = createOgsButton((kind) => void handleClick(kind));
    }
    button.mount(container);

    if (panelHint) {
        button.setState({ kind: "hint" });
        return;
    }
    if (!(await readSignedIn())) {
        button.setState({ kind: "signed-out" });
        return;
    }

    const job = await readJobStatus();
    if (job !== null && job.gameId === game.gameId) {
        if (job.status === "queued" || job.status === "running") {
            button.setState({
                kind: "running",
                label:
                    job.total > 0
                        ? `Reviewing… ${job.done}/${job.total}`
                        : "Reviewing…",
            });
            return;
        }
        if (job.status === "succeeded") {
            button.setState({ kind: "done" });
            return;
        }
    }
    button.setState({ kind: "ready" });
}

async function handleClick(kind: ButtonKind): Promise<void> {
    if (kind === "hint" || kind === "running") {
        return;
    }
    if (kind === "signed-out") {
        await chrome.runtime.sendMessage({ type: "open-login" });
        return;
    }

    // Ask for the panel FIRST and do not await anything before it. The user gesture
    // that arrives with this message is consumed by the first await, after which
    // sidePanel.open() throws "may only be called in response to a user gesture".
    const opened = (await chrome.runtime.sendMessage({
        type: "open-side-panel",
    })) as { ok: boolean } | undefined;

    if (opened?.ok !== true) {
        // The panel could not be opened programmatically. Say so rather than
        // silently doing nothing; generation still starts below.
        panelHint = true;
        void render();
        setTimeout(() => {
            panelHint = false;
            void render();
        }, 6000);
    }

    if (kind === "ready" && game.state === "ready") {
        await chrome.runtime.sendMessage({
            type: "start-from-button",
            gameId: game.gameId,
        });
    }
}

/** Start watching this page. Only called on online-go.com. */
export async function startButton(): Promise<void> {
    if (location.origin !== OGS_ORIGIN) {
        return;
    }

    game = await checkOgsGame(location.href);
    void render();

    watchForMount({
        onNavigate: (check) => {
            game = check;
            panelHint = false;
            button?.destroy();
            button = null;
            void render();
        },
        onMaybeRemount: () => {
            if (game.state === "ready" && button?.isMounted() !== true) {
                void render();
            }
        },
    });

    // The worker mirrors run progress into local storage for exactly this.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") {
            return;
        }
        if (JOB_STATUS_KEY in changes || AUTH_STORAGE_KEY in changes) {
            void render();
        }
    });
}
