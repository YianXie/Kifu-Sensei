import type { ButtonHTMLAttributes } from "react";

import Icon, { type IconName } from "./Icon";

type IconButtonProps = {
    icon: IconName;
    /** Required — it becomes the accessible name, since the glyph is aria-hidden. */
    label: string;
    size?: "sm" | "md" | "lg";
    tone?: "neutral" | "accent" | "danger";
    solid?: boolean;
    className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

/** A square, label-only control. */
export default function IconButton({
    icon,
    label,
    size = "md",
    tone = "neutral",
    solid = false,
    disabled = false,
    className = "",
    ...rest
}: IconButtonProps) {
    const cls = [
        "ks-iconbtn",
        `ks-iconbtn--${size}`,
        `ks-iconbtn--${tone}`,
        solid ? "ks-iconbtn--solid" : "",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <button
            className={cls}
            aria-label={label}
            title={label}
            disabled={disabled}
            type="button"
            {...rest}
        >
            <Icon name={icon} />
        </button>
    );
}
