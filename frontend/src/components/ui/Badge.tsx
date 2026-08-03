import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone =
    | "neutral"
    | "accent"
    | "black"
    | "white"
    | "blunder"
    | "mistake"
    | "notable";

/**
 * Small status marker. The stone tones (`black` / `white`) label whose move a
 * comment belongs to; the severity tones label how bad it was.
 */
export default function Badge({
    children,
    tone = "neutral",
    className = "",
    ...rest
}: {
    children?: ReactNode;
    tone?: BadgeTone;
    className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
    return (
        <span
            className={`ks-badge ks-badge--${tone} ${className}`.trim()}
            {...rest}
        >
            {children}
        </span>
    );
}
