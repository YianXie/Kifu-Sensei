import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Modal. Confirm-style dialogs put the safe action on the left as a ghost
 * button and the committing action on the right as primary.
 *
 * Rendered into `document.body` so no ancestor's `overflow` or stacking context
 * can clip it. Escape and a scrim click both call `onClose`; focus moves into
 * the dialog on open and returns to whatever had it when the dialog closes.
 */
export default function Dialog({
    open = true,
    title,
    children,
    actions,
    size = "md",
    onClose,
    /** Wraps the body and footer in a `<form>`, so Enter submits. */
    onSubmit,
    className = "",
}: {
    open?: boolean;
    title?: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
    size?: "sm" | "md" | "lg";
    onClose?: () => void;
    onSubmit?: (event: React.FormEvent) => void;
    className?: string;
}) {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    // Captured on open so focus can go back where it came from on close.
    const previouslyFocused = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!open) return;

        previouslyFocused.current =
            document.activeElement as HTMLElement | null;

        // Prefer the first focusable control — usually the input a dialog exists
        // to collect — and fall back to the dialog itself so focus never stays
        // behind on the page underneath.
        const focusable = dialogRef.current?.querySelector<HTMLElement>(
            "input:not([type=hidden]), textarea, select, button, [href], [tabindex]:not([tabindex='-1'])"
        );
        (focusable ?? dialogRef.current)?.focus();

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose?.();
            }
        }
        document.addEventListener("keydown", handleKeyDown);

        const { overflow } = document.body.style;
        document.body.style.overflow = "hidden";

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = overflow;
            previouslyFocused.current?.focus();
        };
    }, [open, onClose]);

    if (!open) return null;

    const body = (
        <>
            <div className="ks-dialog__body">{children}</div>
            {actions ? (
                <div className="ks-dialog__footer">{actions}</div>
            ) : null}
        </>
    );

    return createPortal(
        <div className="ks-dialog-scrim" onClick={onClose}>
            <div
                ref={dialogRef}
                className={`ks-dialog${size !== "md" ? ` ks-dialog--${size}` : ""} ${className}`.trim()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
            >
                {title ? (
                    <h2 className="ks-dialog__title" id={titleId}>
                        {title}
                    </h2>
                ) : null}
                {onSubmit ? <form onSubmit={onSubmit}>{body}</form> : body}
            </div>
        </div>,
        document.body
    );
}
