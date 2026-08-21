/**
 * The job mirror written to `chrome.storage.local` for the injected OGS button.
 *
 * `chrome.storage.session` (and so the full job `readJob` returns) is wiped on a
 * browser restart; `chrome.storage.local` is not. `startedAt` on the mirror is what
 * lets a reader (see `button/controller.ts`) tell a job still genuinely in progress
 * apart from one orphaned by a worker that died mid-run before writing a terminal
 * status — without it, nothing would ever move the mirror past "queued"/"running".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_COMMENTARY_CONFIG } from "@shared/commentary";

import { fakeChrome } from "../test/setup";
import { ENDPOINTS } from "./config";
import { AUTH_STORAGE_KEY, JOB_SESSION_KEY, JOB_STATUS_KEY } from "./constants";
import {
    POLL_INTERVAL_MS,
    SUBMIT_TIMEOUT_MS,
    type StoredJob,
    clearJob,
    runJobPoller,
    submitJob,
} from "./jobs";
import type { PublicJobStatus } from "./jobs";

const AUTH = { accessToken: "access-1", refreshToken: "refresh-1" };

function response(status: number, body: unknown = {}): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

function baseJob(overrides: Partial<StoredJob> = {}): StoredJob {
    return {
        jobId: "",
        gameId: 42,
        status: "queued",
        progress: { done: 0, total: 0 },
        result: null,
        error: null,
        startedAt: 0,
        config: DEFAULT_COMMENTARY_CONFIG,
        sgf: "(;FF[4])",
        ...overrides,
    };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await fakeChrome().storage.local.set({ [AUTH_STORAGE_KEY]: AUTH });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("submitJob's status mirror", () => {
    it("stamps startedAt on the public mirror", async () => {
        fetchMock.mockResolvedValue(
            response(202, { job_id: "job-1", status: "queued" })
        );
        const before = Date.now();

        await submitJob(baseJob());

        const stored = fakeChrome().storage.local._dump();
        const mirror = stored[JOB_STATUS_KEY] as PublicJobStatus;
        expect(mirror.startedAt).toBeGreaterThanOrEqual(before);
        expect(mirror.startedAt).toBeLessThanOrEqual(Date.now());
    });

    it("mirrors gameId, status, and progress alongside startedAt", async () => {
        fetchMock.mockResolvedValue(
            response(202, { job_id: "job-1", status: "queued" })
        );

        await submitJob(baseJob({ gameId: 7 }));

        const stored = fakeChrome().storage.local._dump();
        expect(stored[JOB_STATUS_KEY]).toMatchObject({
            gameId: 7,
            status: "queued",
            done: 0,
            total: 0,
        });
    });
});

describe("submitJob's timeout handling", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("reports a timeout, not a network failure, when the request is aborted by the deadline", async () => {
        vi.useFakeTimers();
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => {
                        reject(
                            new DOMException(
                                "The operation was aborted.",
                                "AbortError"
                            )
                        );
                    });
                })
        );

        const resultPromise = submitJob(baseJob());
        await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS);
        const result = await resultPromise;

        expect(result.status).toBe("failed");
        expect(result.error).toMatchObject({ code: "timeout" });
    });
});

describe("runJobPoller", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not re-write storage when a poll reports no change", async () => {
        vi.useFakeTimers();
        // Must be "now" on the fake clock — `runJobPoller` fails any job whose
        // `startedAt` is already more than `JOB_DEADLINE_MS` in the past.
        const running = baseJob({
            jobId: "job-1",
            status: "running",
            progress: { done: 1, total: 5 },
            startedAt: Date.now(),
        });
        await fakeChrome().storage.session.set({ [JOB_SESSION_KEY]: running });
        fakeChrome().storage.session.set.mockClear();

        fetchMock
            .mockResolvedValueOnce(
                response(200, {
                    status: "running",
                    progress: { done: 1, total: 5 },
                    result: null,
                })
            )
            .mockResolvedValueOnce(
                response(200, {
                    status: "succeeded",
                    progress: { done: 5, total: 5 },
                    result: { moves: [] },
                })
            );

        const pollerPromise = runJobPoller();
        // First poll reports the identical status/progress already in storage.
        await vi.advanceTimersByTimeAsync(0);
        expect(fakeChrome().storage.session.set).not.toHaveBeenCalled();

        // Second poll (after the interval) reports the real, terminal change.
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        await pollerPromise;

        expect(fakeChrome().storage.session.set).toHaveBeenCalledTimes(1);
        const stored = fakeChrome().storage.session._dump()[
            JOB_SESSION_KEY
        ] as StoredJob;
        expect(stored.status).toBe("succeeded");
    });
});

describe("clearJob", () => {
    it("removes the session job and the local mirror together", async () => {
        await fakeChrome().storage.session.set({
            [JOB_SESSION_KEY]: baseJob(),
        });
        await fakeChrome().storage.local.set({
            [JOB_STATUS_KEY]: {
                gameId: 1,
                status: "running",
                done: 1,
                total: 2,
                startedAt: 0,
            },
        });

        await clearJob();

        expect(
            fakeChrome().storage.session._dump()[JOB_SESSION_KEY]
        ).toBeUndefined();
        expect(
            fakeChrome().storage.local._dump()[JOB_STATUS_KEY]
        ).toBeUndefined();
    });
});

describe("ENDPOINTS.commentaryJobs sanity", () => {
    it("is the URL submitJob actually posts to", async () => {
        fetchMock.mockResolvedValue(
            response(202, { job_id: "job-1", status: "queued" })
        );
        await submitJob(baseJob());
        expect(fetchMock).toHaveBeenCalledWith(
            ENDPOINTS.commentaryJobs,
            expect.objectContaining({ method: "POST" })
        );
    });
});
