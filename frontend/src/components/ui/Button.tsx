import type { ButtonHTMLAttributes, ReactNode } from "react";

import Icon, { type IconName } from "./Icon";

export type ButtonVariant = "primary" | "outline" | "ghost" | "link";
export type ButtonTone = "accent" | "danger" | "neutral";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
    children?: ReactNode;
    variant?: ButtonVariant;
    tone?: ButtonTone;
    size?: ButtonSize;
    startIcon?: IconName;
    endIcon?: IconName;
    block?: boolean;
    className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The product's primary action control. Three visual weights (primary /
 * outline / ghost) plus an inline `link` weight, three sizes, three tones.
 */
export default function Button({
    children,
    variant = "primary",
    tone = "accent",
    size = "md",
    startIcon,
    endIcon,
    block = false,
    disabled = false,
    className = "",
    type = "button",
    ...rest
}: ButtonProps) {
    const cls = [
        "ks-btn",
        `ks-btn--${variant}`,
        `ks-btn--${tone}`,
        variant !== "link" ? `ks-btn--${size}` : "",
        block ? "ks-btn--block" : "",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <button className={cls} disabled={disabled} type={type} {...rest}>
            {startIcon ? <Icon name={startIcon} size="sm" /> : null}
            {children}
            {endIcon ? <Icon name={endIcon} size="sm" /> : null}
        </button>
    );
}
