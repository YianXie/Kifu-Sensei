import type { CSSProperties } from "react";

/** Indeterminate ring. */
export default function Spinner({
    size = 24,
    label,
    className = "",
    style,
}: {
    size?: number;
    /** Rendered under the ring, and used as the live-region text. */
    label?: string;
    className?: string;
    style?: CSSProperties;
}) {
    const ring = (
        <span
            className={`ks-spinner ${className}`.trim()}
            style={{
                width: size,
                height: size,
                borderWidth: Math.max(2, Math.round(size / 12)),
                ...style,
            }}
            role={label ? undefined : "status"}
            aria-label={label ? undefined : "Loading"}
        />
    );

    if (!label) return ring;

    return (
        <div
            role="status"
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-8)",
            }}
        >
            {ring}
            <span
                style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-secondary)",
                }}
            >
                {label}
            </span>
        </div>
    );
}
