// Service worker. Owns commentary runs so they outlive the side panel, and keeps
// polling across its own restarts.
import {
    type CommentaryConfig,
    DEFAULT_COMMENTARY_CONFIG,
    clampCommentaryConfig,
} from "@shared/commentary";

import { isAuthObject, setCurrentAuth } from "./shared/api";
import { FRONTEND_URL } from "./shared/config";
import {
    ACCOUNT_STATE_KEY,
    AUTH_STORAGE_KEY,
    CONFIG_STORAGE_KEY,
} from "./shared/constants";
import {
    clearJob,
    isTerminal,
    readJob,
    resubmitJob,
    runJobPoller,
    startCommentaryJob,
} from "./shared/jobs";
import type { AccountState } from "./shared/types";

/**
 * Wakes the worker if Chrome tore it down mid-run. One minute is the documented
 * floor for a released extension; some builds accept 0.5, which is not relied on.
 * While the worker is alive the poll loop's own 3s requests keep it awake, so this
 * only matters after an unexpected teardown.
 */
const POLL_ALARM = "kifu-sensei-poll";
const POLL_ALARM_PERIOD_MINUTES = 1;

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

async function ensurePollAlarm(): Promise<void> {
    const existing = await chrome.alarms.get(POLL_ALARM);
    if (existing === undefined) {
        await chrome.alarms.create(POLL_ALARM, {
            periodInMinutes: POLL_ALARM_PERIOD_MINUTES,
        });
    }
}

async function clearPollAlarm(): Promise<void> {
    await chrome.alarms.clear(POLL_ALARM);
}

/** Poll to completion, then stop the alarm so an idle worker is not woken forever. */
async function driveJob(): Promise<void> {
    await ensurePollAlarm();
    try {
        await runJobPoller();
    } finally {
        const job = await readJob();
        if (job === null || job.jobId === "" || isTerminal(job.status)) {
            await clearPollAlarm();
        }
    }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== POLL_ALARM) {
        return;
    }
    void driveJob();
});

// Nothing is in flight across a browser restart — chrome.storage.session (the full
// job) is already gone — but the alarm and the chrome.storage.local status mirror
// both outlive it. Leaving the mirror behind is what used to make the injected OGS
// button show "Reviewing…" forever after a restart mid-run, with no poller left
// alive to ever move it past that. clearJob() is the fast path for the common case;
// PublicJobStatus.startedAt (checked in button/controller.ts) is the backstop for
// however this event is missed — it does not fire for a manual reload of an
// unpacked build, for instance.
chrome.runtime.onStartup.addListener(() => {
    void clearPollAlarm();
    void clearJob();
});

/**
 * Keep the worker's cached session from outliving a sign-out.
 *
 * `shared/api.ts` caches the token pair in module scope and only consults storage
 * when that cache is empty — right for a worker Chrome tears down constantly, but
 * it meant nothing could ever *clear* the cache. Neither sign-out path touched it:
 * the panel and the content script both write to `chrome.storage.local`, and the
 * worker was the one context not listening. A worker that survived the sign-out
 * kept a live session in memory, and its next refresh wrote the rotated pair
 * straight back to storage — reviving the session the user had just ended.
 */
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(AUTH_STORAGE_KEY in changes)) {
        return;
    }
    const { newValue } = changes[AUTH_STORAGE_KEY];
    setCurrentAuth(isAuthObject(newValue) ? newValue : null);
});

type PanelMessage =
    | { type: "start-commentary"; gameId: number; config: CommentaryConfig }
    | { type: "start-from-button"; gameId: number }
    | { type: "open-side-panel" }
    | { type: "open-login" }
    | { type: "regenerate-commentary" }
    | { type: "resume-polling" }
    | { type: "cancel-commentary" };

interface MessageResult {
    ok: boolean;
    /** False when there was no cached record to re-run, so the caller starts fresh. */
    resubmitted?: boolean;
}

function isPanelMessage(value: unknown): value is PanelMessage {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as PanelMessage).type === "string"
    );
}

async function handleMessage(message: PanelMessage): Promise<MessageResult> {
    switch (message.type) {
        case "start-commentary": {
            const job = await startCommentaryJob(
                message.gameId,
                message.config
            );
            if (!isTerminal(job.status)) {
                void driveJob();
            }
            return { ok: job.status !== "failed" };
        }
        case "start-from-button": {
            // The button shows no config screen, so it uses the last config chosen
            // in the panel, then the account's own default, and only then the
            // shared defaults. That last fallback used to be the only one after the
            // panel's local copy, so an account's carefully chosen defaults were
            // ignored entirely by the one entry point that never asks.
            const stored = await chrome.storage.local.get([
                CONFIG_STORAGE_KEY,
                ACCOUNT_STATE_KEY,
            ]);
            const saved = stored[CONFIG_STORAGE_KEY] as
                CommentaryConfig | undefined;
            const account = stored[ACCOUNT_STATE_KEY] as
                AccountState | undefined;
            const config = clampCommentaryConfig(
                saved ?? account?.commentaryConfig ?? DEFAULT_COMMENTARY_CONFIG
            );
            const job = await startCommentaryJob(message.gameId, config);
            if (!isTerminal(job.status)) {
                void driveJob();
            }
            return { ok: job.status !== "failed" };
        }
        case "open-login": {
            await chrome.tabs.create({
                url: `${FRONTEND_URL}/login?source=extension`,
            });
            return { ok: true };
        }
        case "open-side-panel": {
            // Handled synchronously in the listener; see the note there.
            return { ok: false };
        }
        case "regenerate-commentary": {
            const previous = await readJob();
            if (previous === null || previous.sgf === "") {
                // Nothing cached — e.g. the first attempt never got the record.
                return { ok: false, resubmitted: false };
            }
            const job = await resubmitJob(previous);
            if (!isTerminal(job.status)) {
                void driveJob();
            }
            return { ok: job.status !== "failed", resubmitted: true };
        }
        case "resume-polling": {
            // The panel reopened. If a run is still going, make sure something is
            // polling it — this worker may have been restarted since it began.
            const job = await readJob();
            if (job !== null && job.jobId !== "" && !isTerminal(job.status)) {
                void driveJob();
            }
            return { ok: true };
        }
        case "cancel-commentary": {
            await clearJob();
            await clearPollAlarm();
            return { ok: true };
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isPanelMessage(message)) {
        return false;
    }

    // MUST stay above every `await` in this listener.
    //
    // A message from a content script carries the click's user gesture, but it is a
    // restricted one: the first Promise resolution discards it, and `sidePanel.open()`
    // then fails with "may only be called in response to a user gesture"
    // (crbug 355266358). So this branch calls it directly, before `handleMessage` —
    // which is async — is ever reached.
    if (message.type === "open-side-panel") {
        const windowId = sender.tab?.windowId;
        if (windowId === undefined) {
            sendResponse({ ok: false });
            return true;
        }
        chrome.sidePanel.open({ windowId }).then(
            () => sendResponse({ ok: true }),
            (error: unknown) => {
                console.warn(
                    "[Kifu-Sensei worker] Could not open the side panel:",
                    error
                );
                sendResponse({ ok: false });
            }
        );
        return true;
    }

    handleMessage(message).then(sendResponse, (error: unknown) => {
        console.error(
            "[Kifu-Sensei worker] Message failed:",
            message.type,
            error
        );
        sendResponse({ ok: false });
    });
    // Keep the message channel open for the async reply.
    return true;
});
