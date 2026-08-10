// The Kifu-Sensei button injected into an OGS game page.
//
// Lives in a shadow root so that none of OGS's stylesheets reach it and none of its
// styles reach OGS. `:host { all: initial }` resets the inherited properties that do
// cross a shadow boundary — OGS sets Nunito 16px on the surrounding `.PlayControls`,
// which would otherwise leak in.
//
// Colours come from the design system's tokens, inlined rather than imported: a
// shadow root cannot see a stylesheet the page has not loaded, and this one is
// deliberately sealed off from OGS's CSS. They are the resolved values of
// `--accent` / `--accent-press` / `--accent-hover` in each theme, so the button
// matches the side panel rather than drifting from it.

const HOST_ID = "kifu-sensei-root";

export type ButtonKind = "signed-out" | "ready" | "running" | "done" | "hint";

export interface ButtonState {
    kind: ButtonKind;
    /** Overrides the default label — used for progress and the panel hint. */
    label?: string;
}

const DEFAULT_LABELS: Record<ButtonKind, string> = {
    "signed-out": "Sign in to review",
    ready: "Review with Kifu-Sensei",
    running: "Reviewing…",
    done: "View commentary",
    hint: "Open the Kifu-Sensei icon",
};

const STYLES = `
:host {
    /* Reset everything inheritable before styling; OGS sets font on the container. */
    all: initial;
    display: inline-block;
}

.ks-button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    box-sizing: border-box;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: #2a6b4f; /* --kaya-500, the light-theme --accent */
    color: #ffffff; /* --accent-contrast */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: background 0.15s;
}
.ks-button:hover:not(:disabled) { background: #215a41; } /* --kaya-600 */
.ks-button:disabled { cursor: default; opacity: 0.75; }

.ks-button:focus-visible {
    outline: 2px solid #3d9970; /* --kaya-400 */
    outline-offset: 2px;
}

.ks-logo {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    flex-shrink: 0;
}

.ks-label {
    flex: 1;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* OGS resolves its own "system" setting to a concrete value and writes it to
   <html data-theme>, so that — not prefers-color-scheme — is the signal. The host
   mirrors it, because a shadow root cannot match an ancestor attribute.

   Brass, not green: the panel's accent flips to brass in dark, and a green button
   on a dark OGS next to a brass panel is exactly the split this is fixing. */
:host([data-ks-theme="dark"]) .ks-button,
:host([data-ks-theme="accessible"]) .ks-button {
    background: #c9a227; /* --brass-400, the dark-theme --accent */
    color: #0b0b0c; /* --ink-950, the dark --accent-contrast */
}
:host([data-ks-theme="dark"]) .ks-button:hover:not(:disabled),
:host([data-ks-theme="accessible"]) .ks-button:hover:not(:disabled) {
    background: #dfc069; /* --brass-300 */
}
:host([data-ks-theme="dark"]) .ks-button:focus-visible,
:host([data-ks-theme="accessible"]) .ks-button:focus-visible {
    outline-color: #dfc069;
}
:host([data-ks-theme="dark"]) .ks-spinner,
:host([data-ks-theme="accessible"]) .ks-spinner {
    border-color: rgba(11, 11, 12, 0.35);
    border-top-color: #0b0b0c;
}

.ks-spinner {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: ks-spin 0.9s linear infinite;
}

@keyframes ks-spin {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    .ks-spinner { animation: none; }
}
`;

export interface OgsButtonController {
    /** Attach to a container. Safe to call repeatedly; re-mounts if detached. */
    mount(container: Element): void;
    setState(state: ButtonState): void;
    /** True when the host is still in the document. */
    isMounted(): boolean;
    destroy(): void;
}

export function createOgsButton(
    onClick: (kind: ButtonKind) => void
): OgsButtonController {
    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = STYLES;

    const button = document.createElement("button");
    button.className = "ks-button";
    button.type = "button";

    const logo = document.createElement("img");
    logo.className = "ks-logo";
    logo.alt = "";
    logo.src = chrome.runtime.getURL("dist/icons/icon-32.png");

    const spinner = document.createElement("span");
    spinner.className = "ks-spinner";

    const label = document.createElement("span");
    label.className = "ks-label";

    button.append(logo, label);
    root.append(style, button);

    let kind: ButtonKind = "ready";
    button.addEventListener("click", () => onClick(kind));

    // OGS's theme can change while the page is open, from its own nav.
    const applyTheme = (): void => {
        host.setAttribute(
            "data-ks-theme",
            document.documentElement.dataset.theme ?? "light"
        );
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
    });

    return {
        mount(container: Element): void {
            // Reloading an unpacked extension re-injects the content script into
            // tabs that are already open, but the previous script's button stays in
            // the page with dead listeners. Clear any host that is not this one, so
            // the user never ends up with two buttons of which one does nothing.
            for (const stale of document.querySelectorAll(`#${HOST_ID}`)) {
                if (stale !== host) {
                    stale.remove();
                }
            }
            if (host.parentElement !== container) {
                container.prepend(host);
            }
        },
        setState(state: ButtonState): void {
            kind = state.kind;
            label.textContent = state.label ?? DEFAULT_LABELS[state.kind];
            button.disabled = state.kind === "running" || state.kind === "hint";
            button.title =
                state.kind === "hint"
                    ? "Chrome would not let the panel open automatically. Click the Kifu-Sensei toolbar icon."
                    : label.textContent;
            if (state.kind === "running") {
                if (spinner.parentElement === null) {
                    logo.replaceWith(spinner);
                }
            } else if (spinner.parentElement !== null) {
                spinner.replaceWith(logo);
            }
        },
        isMounted(): boolean {
            return host.isConnected;
        },
        destroy(): void {
            themeObserver.disconnect();
            host.remove();
        },
    };
}
