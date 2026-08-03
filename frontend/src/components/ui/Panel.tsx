import type { HTMLAttributes, ReactNode } from "react";

/** A bordered form/content region with an optional heading + lead line. */
export default function Panel({
    heading,
    lead,
    tight = false,
    children,
    className = "",
    ...rest
}: {
    heading?: ReactNode;
    lead?: ReactNode;
    tight?: boolean;
    children?: ReactNode;
    className?: string;
} & HTMLAttributes<HTMLElement>) {
    return (
        <section
            className={`ks-panel${tight ? " ks-panel--tight" : ""} ${className}`.trim()}
            {...rest}
        >
            {heading ? <h2 className="ks-panel__heading">{heading}</h2> : null}
            {lead ? <p className="ks-panel__lead">{lead}</p> : null}
            {children}
        </section>
    );
}
