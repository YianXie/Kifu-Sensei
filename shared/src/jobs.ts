// Timing for the async commentary job endpoints, shared so the two surfaces wait the
// same amount of time for the same backend.

/** Submitting is quick; anything slower than this is a failure, not a wait. */
export const SUBMIT_TIMEOUT_MS = 30_000;

/**
 * Each poll is a small read. Kept far below the 30s after which a Manifest V3
 * service worker is torn down mid-fetch.
 */
export const POLL_TIMEOUT_MS = 15_000;

/** Gap between polls. Short enough that the worker's 30s idle timer keeps resetting. */
export const POLL_INTERVAL_MS = 3_000;

/**
 * How long a single run may take before a client gives up on it.
 *
 * Derived from the worst case rather than guessed: three KataGo passes at the
 * backend's 120s `API_TIMEOUT` is 360s, plus up to 100 sequential Claude calls.
 * Fifteen minutes covers a long game at default settings with room to spare; past
 * that, something is wrong rather than slow.
 */
export const JOB_DEADLINE_MS = 900_000;
