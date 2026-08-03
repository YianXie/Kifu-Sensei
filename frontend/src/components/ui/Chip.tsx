import type { HTMLAttributes, ReactNode } from "react";

import Icon from "./Icon";

/**
 * Pill-shaped metadata marker. Used for the hero's "KataGo · Claude · SGF"
 * stack line and for file / config summaries.
 */
export default function Chip({
    label,
    children,
    variant = "outline",
    onDismiss,
    className = "",
    ...rest
}: {
    label?: ReactNode;
    children?: ReactNode;
    variant?: "outline" | "accent" | "filled";
    onDismiss?: () => void;
    className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
    return (
        <span
            className={`ks-chip ks-chip--${variant} ${className}`.trim()}
            {...rest}
        >
            {label ?? children}
            {onDismiss ? (
                <button
                    className="ks-chip__dismiss"
                    aria-label="Remove"
                    onClick={onDismiss}
                    type="button"
                >
                    <Icon name="close" />
                </button>
            ) : null}
        </span>
    );
}
