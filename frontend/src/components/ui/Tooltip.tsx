import type { ReactNode } from "react";

/**
 * Hover/focus label, text only. Purely decorative: the control it wraps carries
 * its own accessible name, so the bubble is hidden from assistive tech rather
 * than announced twice.
 */
export default function Tooltip({
    title,
    children,
    className = "",
}: {
    title: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={`ks-tooltip ${className}`.trim()}>
            {children}
            <span className="ks-tooltip__bubble" aria-hidden="true">
                {title}
            </span>
        </span>
    );
}
