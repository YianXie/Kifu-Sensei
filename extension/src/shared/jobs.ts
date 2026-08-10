// Driving a commentary run from submit to result.
//
// Why a job rather than one request: a Manifest V3 service worker is torn down when a
// single `fetch()` response takes more than 30 seconds, and a review takes minutes. So
// the worker submits the job, then polls it with requests that are each well under
// that limit. Every poll writes to `chrome.storage.session`, which the panel renders —
// so closing and reopening the panel loses nothing, and a worker that is killed
// mid-run is restarted by an alarm and picks up from the stored job id.
//
// Runs here, never in the panel: the panel document dies the moment it is closed.
import {
    type CommentaryConfig,
    clampCommentaryConfig,
} from "@shared/commentary";
import {
    JOB_DEADLINE_MS,
    POLL_INTERVAL_MS,
    POLL_TIMEOUT_MS,
    SUBMIT_TIMEOUT_MS,
} from "@shared/jobs";
import { isCommentaryErrorCode } from "@shared/types";
import type {
    CommentaryApiError,
    CommentaryJobCreated,
    CommentaryJobState,
    CommentaryResponse,
    JobStatus,
} from "@shared/types";

import { authedFetch, readErrorResponse } from "./api";
import { ENDPOINTS } from "./config";
import { JOB_SESSION_KEY, JOB_STATUS_KEY } from "./constants";
import { fetchOgsSgf } from "./ogs";

// Timing lives in @shared/jobs so the web app waits the same amount of time
// for the same backend. Re-exported: the panel and the worker import them
// from here, which is where the job machinery lives.
export {
    JOB_DEADLINE_MS,
    POLL_INTERVAL_MS,
    POLL_TIMEOUT_MS,
    SUBMIT_TIMEOUT_MS,
} from "@shared/jobs";

export interface StoredJob {
    jobId: string;
    /** Which OGS game this run belongs to, so the panel can ignore a stale one. */
    gameId: number;
    status: JobStatus;
    progress: { done: number; total: number };
    result: CommentaryResponse | null;
    error: CommentaryApiError | null;
    /** Epoch ms, for the deadline. */
    startedAt: number;
    /** Kept so Regenerate can re-run without re-fetching from OGS. */
    config: CommentaryConfig;
    sgf: string;
}

export async function readJob(): Promise<StoredJob | null> {
    const stored = await chrome.storage.session.get(JOB_SESSION_KEY);
    const job = stored[JOB_SESSION_KEY];
    return job !== undefined ? (job as StoredJob) : null;
}

/** What the injected button is allowed to see. No record, no commentary. */
export interface PublicJobStatus {
    gameId: number;
    status: JobStatus;
    done: number;
    total: number;
    /**
     * Epoch ms this job started. `chrome.storage.session` (and so `readJob`) is wiped
     * on a browser restart, but this `chrome.storage.local` mirror is not — with
     * nothing left alive to ever move it past "queued"/"running", a reader has to be
     * able to tell a genuinely in-progress job from one orphaned by a worker that
     * died before writing a terminal status. `background.ts` clears this on startup
     * as the fast path; `startedAt` is the backstop for however that is missed (e.g.
     * a manual reload of an unpacked build, which fires no startup event).
     */
    startedAt: number;
}

async function writeJob(job: StoredJob): Promise<void> {
    const publicStatus: PublicJobStatus = {
        gameId: job.gameId,
        status: job.status,
        done: job.progress.done,
        total: job.progress.total,
        startedAt: job.startedAt,
    };
    await Promise.all([
        chrome.storage.session.set({ [JOB_SESSION_KEY]: job }),
        chrome.storage.local.set({ [JOB_STATUS_KEY]: publicStatus }),
    ]);
}

export async function clearJob(): Promise<void> {
    await Promise.all([
        chrome.storage.session.remove(JOB_SESSION_KEY),
        chrome.storage.local.remove(JOB_STATUS_KEY),
    ]);
}

export function isTerminal(status: JobStatus): boolean {
    return status === "succeeded" || status === "failed";
}

function fail(job: StoredJob, error: CommentaryApiError): StoredJob {
    return { ...job, status: "failed", error };
}

/**
 * Whether two job snapshots render the same. `pollOnce` returns a fresh object every
 * tick even when nothing changed (e.g. still "running" between progress updates), so
 * this compares the fields the panel and injected button actually display rather than
 * relying on reference equality.
 */
function jobStatusUnchanged(a: StoredJob, b: StoredJob): boolean {
    return (
        a.status === b.status &&
        a.progress.done === b.progress.done &&
        a.progress.total === b.progress.total &&
        a.result === b.result &&
        a.error === b.error
    );
}

/**
 * `null` on a genuine network failure, `"timeout"` when the deadline was the cause.
 *
 * `authedFetch` catches every error `fetch()` can throw — including the AbortError
 * this timeout raises — and already reports it as `null`, so it never leaves this
 * function to be caught by a `try`/`catch` around the call. The two are told apart
 * by the abort signal, not by an exception.
 */
async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response | null | "timeout"> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await authedFetch(url, {
            ...init,
            signal: controller.signal,
        });
        return response === null && controller.signal.aborted
            ? "timeout"
            : response;
    } finally {
        clearTimeout(timer);
    }
}

const SGF_ERRORS: Record<string, string> = {
    unfinished:
        "online-go.com will not release this game's record until it has finished.",
    "not-found": "That game's record could not be found on online-go.com.",
    offline: "Could not download the game from online-go.com.",
    empty: "online-go.com returned an empty game record.",
};

/**
 * Fetch the game record, submit it, and store the queued job.
 *
 * Replaces whatever job was stored: there is one slot, so starting a review for a new
 * game abandons the previous run rather than tracking both.
 */
export async function startCommentaryJob(
    gameId: number,
    config: CommentaryConfig
): Promise<StoredJob> {
    const base: StoredJob = {
        jobId: "",
        gameId,
        status: "queued",
        progress: { done: 0, total: 0 },
        result: null,
        error: null,
        startedAt: Date.now(),
        config: clampCommentaryConfig(config),
        sgf: "",
    };

    const sgf = await fetchOgsSgf(gameId);
    if (!sgf.ok) {
        const job = fail(base, {
            code: "sgf_unavailable",
            detail: SGF_ERRORS[sgf.reason] ?? SGF_ERRORS.offline,
            retryAfter: null,
        });
        await writeJob(job);
        return job;
    }

    const withSgf: StoredJob = { ...base, sgf: sgf.sgf };
    return submitJob(withSgf);
}

/** POST the request and record the returned job id. Shared with Regenerate. */
export async function submitJob(job: StoredJob): Promise<StoredJob> {
    // The backend enforces min_length=5; `ogs-1.sgf` is already 9 characters, so this
    // cannot be too short for any real game id.
    const sgfFileName = `ogs-${job.gameId}.sgf`;

    const response = await fetchWithTimeout(
        ENDPOINTS.commentaryJobs,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sgf_content: job.sgf,
                sgf_file_name: sgfFileName,
                ...job.config,
            }),
        },
        SUBMIT_TIMEOUT_MS
    );

    if (response === "timeout") {
        const failed = fail(job, {
            code: "timeout",
            detail: "Kifu-Sensei took too long to accept the game. Please try again.",
            retryAfter: null,
        });
        await writeJob(failed);
        return failed;
    }

    if (response === null) {
        const failed = fail(job, {
            code: "network",
            detail: "Could not reach Kifu-Sensei. Check your connection and try again.",
            retryAfter: null,
        });
        await writeJob(failed);
        return failed;
    }

    if (response.status === 401) {
        // authedFetch already tried the refresh token, so the session is genuinely
        // dead rather than merely stale.
        const failed = fail(job, {
            code: "session_expired",
            detail: "Your session expired. Sign in again on the Kifu-Sensei website.",
            retryAfter: null,
        });
        await writeJob(failed);
        return failed;
    }

    if (!response.ok) {
        const failed = fail(job, await readErrorResponse(response));
        await writeJob(failed);
        return failed;
    }

    let created: CommentaryJobCreated;
    try {
        created = (await response.json()) as CommentaryJobCreated;
    } catch {
        const failed = fail(job, {
            code: "internal_error",
            detail: "Kifu-Sensei returned an unreadable response.",
            retryAfter: null,
        });
        await writeJob(failed);
        return failed;
    }

    const queued: StoredJob = {
        ...job,
        jobId: created.job_id,
        status: created.status,
        startedAt: Date.now(),
        error: null,
        result: null,
    };
    await writeJob(queued);
    return queued;
}

/**
 * Re-run a job using the game record already downloaded.
 *
 * Regenerate and retry both go through here: the SGF is already in hand, so there is
 * no second OGS round-trip, and a review can still be re-run after the game itself has
 * become unavailable. The config is reused as-is.
 */
export async function resubmitJob(previous: StoredJob): Promise<StoredJob> {
    return submitJob({
        ...previous,
        jobId: "",
        status: "queued",
        progress: { done: 0, total: 0 },
        result: null,
        error: null,
        startedAt: Date.now(),
    });
}

/** One poll. Returns the updated job, or null when the stored job has gone away. */
async function pollOnce(job: StoredJob): Promise<StoredJob | null> {
    const response = await fetchWithTimeout(
        ENDPOINTS.commentaryJob(job.jobId),
        {},
        POLL_TIMEOUT_MS
    );

    if (response === null || response === "timeout") {
        // A single slow or offline poll is not fatal; try again next tick, up to
        // the deadline in `runJobPoller`.
        return job;
    }
    if (response.status === 401) {
        return fail(job, {
            code: "session_expired",
            detail: "Your session expired. Sign in again on the Kifu-Sensei website.",
            retryAfter: null,
        });
    }
    if (response.status === 404) {
        return fail(job, {
            code: "internal_error",
            detail: "Kifu-Sensei lost track of this review. Please try again.",
            retryAfter: null,
        });
    }
    if (!response.ok) {
        return job; // Transient server hiccup; the deadline is the backstop.
    }

    let state: CommentaryJobState;
    try {
        state = (await response.json()) as CommentaryJobState;
    } catch {
        return job;
    }

    if (state.status === "failed") {
        // Validate rather than trust: this used to be a bare
        // `state.error?.code ?? "internal_error"`, which typed whatever the backend
        // sent as a member of the union. `job_abandoned` reached the panel that way
        // — a code nothing downstream knew how to explain.
        const code = state.error?.code;
        return fail(job, {
            code: isCommentaryErrorCode(code) ? code : "internal_error",
            detail: state.error?.detail ?? "Failed to generate commentary.",
            retryAfter: state.error?.retry_after ?? null,
        });
    }

    return {
        ...job,
        status: state.status,
        progress: state.progress ?? job.progress,
        result: state.result,
    };
}

// One poll loop per worker instance. An alarm firing while a loop is already running
// must not start a second one.
let polling = false;

/**
 * Poll the stored job until it finishes, fails, or runs out of time.
 *
 * Safe to call repeatedly — from the alarm, from a panel request, from startup. It
 * re-reads the job from storage each tick, so a run started by an earlier worker
 * instance is picked up transparently.
 */
export async function runJobPoller(): Promise<void> {
    if (polling) {
        return;
    }
    polling = true;
    try {
        for (;;) {
            const job = await readJob();
            if (job === null || job.jobId === "" || isTerminal(job.status)) {
                return;
            }

            if (Date.now() - job.startedAt > JOB_DEADLINE_MS) {
                await writeJob(
                    fail(job, {
                        code: "timeout",
                        detail: `This review passed ${Math.round(
                            JOB_DEADLINE_MS / 60_000
                        )} minutes and was stopped. Try again with fewer comments.`,
                        retryAfter: null,
                    })
                );
                return;
            }

            const updated = await pollOnce(job);
            if (updated === null) {
                return;
            }
            if (!jobStatusUnchanged(job, updated)) {
                await writeJob(updated);
            }
            if (isTerminal(updated.status)) {
                return;
            }

            await new Promise((resolve) =>
                setTimeout(resolve, POLL_INTERVAL_MS)
            );
        }
    } finally {
        polling = false;
    }
}
