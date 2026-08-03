import type { ReactNode } from "react";

import Icon, { type IconName } from "./Icon";

export type AlertSeverity = "error" | "warning" | "success" | "info";

const ALERT_ICONS: Record<AlertSeverity, IconName> = {
    error: "error",
    warning: "warning",
    success: "check_circle",
    info: "info",
};

/** Inline, in-flow message. Sits above the form it belongs to. */
export default function Alert({
    severity = "error",
    title,
    children,
    icon,
    className = "",
}: {
    severity?: AlertSeverity;
    title?: ReactNode;
    children?: ReactNode;
    icon?: IconName;
    className?: string;
}) {
    return (
        <div
            className={`ks-alert ks-alert--${severity} ${className}`.trim()}
            role="alert"
        >
            <Icon name={icon ?? ALERT_ICONS[severity]} />
            <div className="ks-alert__body">
                {title ? (
                    <strong className="ks-alert__title">{title}</strong>
                ) : null}
                {children}
            </div>
        </div>
    );
}
