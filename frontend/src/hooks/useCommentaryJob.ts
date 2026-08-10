import { useCallback, useEffect, useRef, useState } from "react";

import { JOB_DEADLINE_MS, POLL_INTERVAL_MS } from "@shared/jobs";
import type {
    CommentaryJobProgress,
    CommentaryJobState,
    CommentaryResponse,
} from "@shared/types";

import api from "@/api";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { getCommentaryError } from "@/utils/errorFormatting";

/**
 * Drive a commentary run through the async job endpoints.
 *
 * The web app used to POST the synchronous `/api/commentary/` and hold one request
 * open for minutes. The backend deliberately wires `on_progress` only into the job
 * path, so there was nothing to report and the generating screen rendered a fixed
 * four-step list whose own footnote admitted progress was not reported. A reload
 * mid-run lost the result from the UI, and axios had no timeout, so a hung request
 * had nothing that would ever end it.
 *
 * Both surfaces now submit a job and poll it, on the same timings from
 * `@shared/jobs`, against the same one-active-run-per-user slot.
 */

/** Where the in-flight job id survives a reload. */
const JOB_STORAGE_KEY = "ks_commentary_job";

interface StoredJob {
    jobId: string;
    startedAt: number;
}

function readStoredJob(): StoredJob | null {
    try {
        const raw = localStorage.getItem(JOB_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredJob;
        return typeof parsed?.jobId === "string" && parsed.jobId
            ? { jobId: parsed.jobId, startedAt: Number(parsed.startedAt) || 0 }
            : null;
    } catch {
        return null;
    }
}

function writeStoredJob(job: StoredJob | null): void {
    try {
        if (job === null) {
            localStorage.removeItem(JOB_STORAGE_KEY);
        } else {
            localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(job));
        }
    } catch {
        // Private-mode storage. The run still works; only resume is lost.
    }
}

export interface CommentaryJobRequest {
    sgf_file_name: string;
    sgf_content: string;
    model: string;
    language: string;
    num_comments: number;
    max_token: number;
    custom_instruction: string;
}

export interface UseCommentaryJob {
    /** True from submission until the run reaches a terminal state. */
    isRunning: boolean;
    /**
     * `null` until the backend knows how many moments there are — the two KataGo
     * passes finish before the first comment, so there is genuinely nothing to
     * measure before then.
     */
    progress: CommentaryJobProgress | null;
    /** Whether this run was picked up rather than started here. */
    isAttached: boolean;
    start: (request: CommentaryJobRequest) => Promise<void>;
    /** Stop watching. The run keeps going server-side; nothing can cancel it. */
    stopWatching: () => void;
}

export function useCommentaryJob({
    onResult,
    onError,
}: {
    onResult: (result: CommentaryResponse) => void;
    onError: (error: ReturnType<typeof getCommentaryError>) => void;
}): UseCommentaryJob {
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<CommentaryJobProgress | null>(
        null
    );
    const [isAttached, setIsAttached] = useState(false);

    // Read inside the loop rather than captured, so `stopWatching` takes effect on
    // the next tick without the loop having to be torn down and rebuilt.
    const watchingRef = useRef(false);

    // The poll loop outlives any one render, so it calls through refs rather than
    // capturing the callbacks it was created with. Updated in an effect, not during
    // render — a ref write during render is not safe under concurrent rendering.
    const onResultRef = useRef(onResult);
    const onErrorRef = useRef(onError);
    useEffect(() => {
        onResultRef.current = onResult;
        onErrorRef.current = onError;
    }, [onResult, onError]);

    const stopWatching = useCallback(() => {
        watchingRef.current = false;
        writeStoredJob(null);
        setIsRunning(false);
        setProgress(null);
        setIsAttached(false);
    }, []);

    const poll = useCallback(
        async (jobId: string, startedAt: number) => {
            watchingRef.current = true;
            setIsRunning(true);

            while (watchingRef.current) {
                if (Date.now() - startedAt > JOB_DEADLINE_MS) {
                    watchingRef.current = false;
                    writeStoredJob(null);
                    setIsRunning(false);
                    onErrorRef.current({
                        code: "timeout",
                        message: `This review passed ${Math.round(JOB_DEADLINE_MS / 60_000)} minutes without finishing. It may still land in History.`,
                        detail: "",
                        action: "retry",
                    });
                    return;
                }

                try {
                    const { data } = await api.get<CommentaryJobState>(
                        ENDPOINTS.commentaryJob(jobId)
                    );

                    if (data.status === "succeeded" && data.result !== null) {
                        watchingRef.current = false;
                        writeStoredJob(null);
                        setIsRunning(false);
                        setProgress(null);
                        setIsAttached(false);
                        onResultRef.current(data.result);
                        return;
                    }
                    if (data.status === "failed") {
                        watchingRef.current = false;
                        writeStoredJob(null);
                        setIsRunning(false);
                        setProgress(null);
                        onErrorRef.current(
                            getCommentaryError({
                                response: { data: data.error ?? {} },
                            })
                        );
                        return;
                    }
                    setProgress(
                        data.progress?.total > 0 ? data.progress : null
                    );
                } catch (error) {
                    // A 404 means the job is gone — pruned after its 24h retention, or
                    // belonging to another account. Nothing to resume.
                    const status = (error as { response?: { status?: number } })
                        ?.response?.status;
                    if (status === 404) {
                        stopWatching();
                        return;
                    }
                    // Anything else is treated as transient: a single failed poll is
                    // not a failed run, and the deadline above is what ends it.
                }

                await new Promise((resolve) =>
                    setTimeout(resolve, POLL_INTERVAL_MS)
                );
            }
        },
        [stopWatching]
    );

    const start = useCallback(
        async (request: CommentaryJobRequest) => {
            setIsRunning(true);
            setProgress(null);
            setIsAttached(false);
            try {
                const { data } = await api.post<{ job_id: string }>(
                    ENDPOINTS.commentaryJobs,
                    request
                );
                const job = { jobId: data.job_id, startedAt: Date.now() };
                writeStoredJob(job);
                void poll(job.jobId, job.startedAt);
            } catch (error) {
                // A run is already going — the extension's, or this account's on
                // another device. Both surfaces share one slot, so the useful move
                // is to watch that run rather than report a conflict the user can
                // do nothing about.
                const body = (
                    error as { response?: { data?: { job_id?: unknown } } }
                )?.response?.data;
                if (typeof body?.job_id === "string") {
                    const job = { jobId: body.job_id, startedAt: Date.now() };
                    writeStoredJob(job);
                    setIsAttached(true);
                    void poll(job.jobId, job.startedAt);
                    return;
                }
                setIsRunning(false);
                onErrorRef.current(getCommentaryError(error));
            }
        },
        [poll]
    );

    // Resume a run this tab was watching before a reload.
    useEffect(() => {
        const stored = readStoredJob();
        if (stored === null) return;
        setIsAttached(true);
        void poll(stored.jobId, stored.startedAt);
        return () => {
            watchingRef.current = false;
        };
        // Once, on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { isRunning, progress, isAttached, start, stopWatching };
}
