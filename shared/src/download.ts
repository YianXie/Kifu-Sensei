// Saving the annotated game record.
//
// This existed three times with three behaviours: the web review screen wrote
// `text/plain` under the *uploaded* file's own name — so downloading replaced the
// file the user had just picked — the web History card wrote `application/x-go-sgf`
// under `{base}_annotated.sgf`, and the panel matched History while its comment
// claimed it matched "the website".

/** What an SGF actually is. `text/plain` was the odd one out. */
export const SGF_MIME_TYPE = "application/x-go-sgf";

/**
 * Name for the annotated copy: `mygame.sgf` becomes `mygame_annotated.sgf`.
 *
 * Never the input name — the annotated record is a different file, and handing the
 * browser the original name means the download silently sits next to (or on top of)
 * the record it was generated from.
 */
export function annotatedFileName(sgfFileName: string): string {
    const base = (sgfFileName || "commentary").replace(/\.sgf$/i, "");
    return `${base}_annotated.sgf`;
}

/**
 * How long to wait before revoking the object URL. Chrome cancels the download if
 * the blob URL dies before it has read it, so this cannot be synchronous — the web
 * app revoked immediately and was relying on luck.
 */
const REVOKE_DELAY_MS = 1_000;

/**
 * Save `content` as the annotated record for `sgfFileName`.
 *
 * The backend has already injected the comments, so this is purely a client-side
 * save — no extra request, and it still works offline.
 */
export function downloadAnnotatedSgf(
    content: string,
    sgfFileName: string
): void {
    const url = URL.createObjectURL(
        new Blob([content], { type: SGF_MIME_TYPE })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = annotatedFileName(sgfFileName);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
