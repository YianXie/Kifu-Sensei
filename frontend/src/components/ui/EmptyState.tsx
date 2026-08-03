import type { HTMLAttributes, ReactNode } from "react";

import Icon, { type IconName } from "./Icon";

/** Centred zero-state: glyph, title, one explanatory line, up to two actions. */
export default function EmptyState({
    icon,
    title,
    body,
    actions,
    className = "",
    ...rest
}: {
    icon?: IconName;
    title?: ReactNode;
    body?: ReactNode;
    actions?: ReactNode;
    className?: string;
} & HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={`ks-empty ${className}`.trim()} {...rest}>
            {icon ? <Icon name={icon} /> : null}
            {title ? <h3 className="ks-empty__title">{title}</h3> : null}
            {body ? <p className="ks-empty__body">{body}</p> : null}
            {actions ? (
                <div className="ks-empty__actions">{actions}</div>
            ) : null}
        </div>
    );
}
