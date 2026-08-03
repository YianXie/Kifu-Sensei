import type { CSSProperties, ReactNode } from "react";

/** 1px rule. With `label`, the rule breaks around a centred mono caption. */
export default function Divider({
    orientation = "horizontal",
    label,
    spacing,
    className = "",
    style,
}: {
    orientation?: "horizontal" | "vertical";
    label?: ReactNode;
    /** Vertical margin above and below, e.g. `"20px"`. */
    spacing?: string;
    className?: string;
    style?: CSSProperties;
}) {
    const margin = spacing ? { margin: `${spacing} 0` } : undefined;

    if (label) {
        return (
            <div
                className={`ks-divider__label ${className}`.trim()}
                style={{ ...margin, ...style }}
            >
                {label}
            </div>
        );
    }

    return (
        <hr
            className={`ks-divider ks-divider--${orientation} ${className}`.trim()}
            style={{ ...margin, ...style }}
        />
    );
}
