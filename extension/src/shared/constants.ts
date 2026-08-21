// Constants that must agree across JS worlds. `inject.ts` runs in the page's own
// world, `content.ts` in the isolated content-script world, and `panel.ts` in the
// side-panel document; before this file each kept its own copy and they had to be
// renamed in lockstep by hand.

/**
 * Key holding `{accessToken, refreshToken}`. The website writes it to its own
 * `localStorage`; the extension persists the verified pair under the same name in
 * `chrome.storage.local`. Same string, two different storage areas.
 */
export const AUTH_STORAGE_KEY = "extension_auth";

/**
 * Refresh token of a session the user explicitly signed out of. The website leaves
 * its `localStorage` entry in place, so without this marker a freshly loaded frontend
 * tab would re-deliver it and silently sign the user back in.
 */
export const REVOKED_AUTH_KEY = "revoked_refresh_token";

/** Tags on the `postMessage` from the page world, so the receiver can filter. */
export const AUTH_MESSAGE_SOURCE = "kifu-sensei-inject";
export const AUTH_MESSAGE_TYPE = "extension_auth_update";

/** Where in-flight and completed commentary runs are cached. */
export const JOB_SESSION_KEY = "commentary_job";

/**
 * A cut-down mirror of the run's status, in `chrome.storage.local`.
 *
 * The full job lives in `chrome.storage.session`, which content scripts cannot read.
 * The injected OGS button needs to know only whether a run is going and how far along
 * it is, so that much is mirrored where the content script can see it — deliberately
 * without the game record or the commentary itself.
 */
export const JOB_STATUS_KEY = "commentary_job_status";

/** Last-used commentary configuration, so Regenerate can reuse it. */
export const CONFIG_STORAGE_KEY = "commentary_config";

/**
 * A snapshot of the account's own settings, cached where every extension context
 * can read it.
 *
 * Only the panel can fetch `/auth/user/settings/`; the service worker and the
 * injected button cannot (the worker has no reason to hold a session's settings,
 * and a content script's fetch would be blocked by CORS). Without a cache the
 * worker fell back to `DEFAULT_COMMENTARY_CONFIG` for one-click reviews — so an
 * account's carefully chosen defaults were ignored by the OGS button — and the
 * button had no way to know whether a key was even set.
 */
export const ACCOUNT_STATE_KEY = "account_state";

export const OGS_ORIGIN = "https://online-go.com";
export const OGS_GAMES_URL = `${OGS_ORIGIN}/observe-games/`;
