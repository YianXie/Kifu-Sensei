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

import { authedFetch, readErrorResponse } from "./api";
import { clampCommentaryConfig, type CommentaryConfig } from "./commentary";
import { ENDPOINTS } from "./config";
import { JOB_SESSION_KEY } from "./constants";
import { fetchOgsSgf } from "./ogs";
import type {
    CommentaryApiError,
    CommentaryJobCreated,
    CommentaryJobState,
    CommentaryResponse,
    JobStatus,
} from "./types";

/** Submitting is quick; anything slower than this is a failure, not a wait. */
const SUBMIT_TIMEOUT_MS = 30_000;
/** Each poll is a small read. Kept far below the worker's 30s fetch limit. */
const POLL_TIMEOUT_MS = 15_000;
/** Gap between polls. Short enough that the worker's 30s idle timer keeps resetting. */
const POLL_INTERVAL_MS = 3_000;

/**
 * How long a single run may take before the panel gives up on it.
 *
 * Derived from the worst case rather than guessed: three KataGo passes at the
 * backend's 120s `API_TIMEOUT` is 360s, plus up to 100 sequential Claude calls. Fifteen
 * minutes covers a long game at default settings with room to spare; past that,
 * something is wrong rather than slow.
 */
export const JOB_DEADLINE_MS = 900_000;

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
async function writeJob(job: StoredJob): Promise<void> {
    await chrome.storage.session.set({ [JOB_SESSION_KEY]: job });
}

export async function clearJob(): Promise<void> {
    await chrome.storage.session.remove(JOB_SESSION_KEY);
}

export function isTerminal(status: JobStatus): boolean {
    return status === "succeeded" || status === "failed";
}

function fail(job: StoredJob, error: CommentaryApiError): StoredJob {
    return { ...job, status: "failed", error };
}

async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await authedFetch(url, { ...init, signal: controller.signal });
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

    let response: Response | null;
    try {
        response = await fetchWithTimeout(
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
    } catch {
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
/**
 * Re-run a job we already have the record for.
 *
 * Deliberately does not go back to OGS: retrying after a rate limit costs one
 * request rather than a download plus a request, and a game that has since become
 * unavailable can still be regenerated.
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
    let response: Response | null;
    try {
        response = await fetchWithTimeout(
            ENDPOINTS.commentaryJob(job.jobId),
            {},
            POLL_TIMEOUT_MS
        );
    } catch {
        return job; // A single slow poll is not fatal; try again next tick.
    }

    if (response === null) {
        return job; // Offline for a moment. Keep polling until the deadline.
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
        return fail(job, {
            code: state.error?.code ?? "internal_error",
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
            await writeJob(updated);
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
