import { type ReactNode, useEffect } from "react";

import IconButton from "./IconButton";

/** Slide-in panel. The product uses the right anchor for mobile navigation. */
export default function Drawer({
    open = true,
    side = "right",
    title,
    children,
    onClose,
    className = "",
}: {
    open?: boolean;
    side?: "left" | "right";
    title?: string;
    children?: ReactNode;
    onClose?: () => void;
    className?: string;
}) {
    useEffect(() => {
        if (!open) return;
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose?.();
        }
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <>
            <div className="ks-drawer-scrim" onClick={onClose} />
            <aside
                className={`ks-drawer${side === "left" ? " ks-drawer--left" : ""} ${className}`.trim()}
                role="dialog"
                aria-modal="true"
                aria-label={title ?? "Navigation"}
            >
                <div className="ks-drawer__header">
                    <span
                        style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                        }}
                    >
                        {title}
                    </span>
                    <IconButton
                        icon="close"
                        label="Close"
                        size="sm"
                        onClick={onClose}
                    />
                </div>
                {children}
            </aside>
        </>
    );
}
