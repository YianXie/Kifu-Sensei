import type { HTMLAttributes, ReactNode } from "react";

import Icon, { type IconName } from "./Icon";

/** Bordered container with optional header, body and action footer. */
export default function Card({
    title,
    subtitle,
    icon,
    iconTone = "accent",
    variant = "default",
    interactive = false,
    actions,
    children,
    className = "",
    ...rest
}: {
    title?: ReactNode;
    subtitle?: ReactNode;
    icon?: IconName;
    iconTone?: "accent" | "neutral";
    variant?: "default" | "flat" | "raised" | "sm";
    interactive?: boolean;
    actions?: ReactNode;
    children?: ReactNode;
    className?: string;
} & HTMLAttributes<HTMLDivElement>) {
    const cls = [
        "ks-card",
        variant !== "default" ? `ks-card--${variant}` : "",
        interactive ? "ks-card--interactive" : "",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div className={cls} {...rest}>
            {title || icon ? (
                <div className="ks-card__header">
                    {icon ? (
                        <span
                            className={`ks-iconplate${iconTone === "neutral" ? " ks-iconplate--neutral" : ""}`}
                        >
                            <Icon name={icon} size="sm" />
                        </span>
                    ) : null}
                    <div>
                        {title ? (
                            <h3 className="ks-card__title">{title}</h3>
                        ) : null}
                        {subtitle ? (
                            <p className="ks-card__subtitle">{subtitle}</p>
                        ) : null}
                    </div>
                </div>
            ) : null}
            {children ? <div className="ks-card__body">{children}</div> : null}
            {actions ? <div className="ks-card__footer">{actions}</div> : null}
        </div>
    );
}
