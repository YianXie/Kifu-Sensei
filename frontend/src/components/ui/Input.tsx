import type { InputHTMLAttributes } from "react";

import Icon, { type IconName } from "./Icon";

/** Single-line text input. */
export default function Input({
    icon,
    mono = false,
    invalid = false,
    valid = false,
    className = "",
    ...rest
}: {
    icon?: IconName;
    mono?: boolean;
    invalid?: boolean;
    valid?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
    const cls = [
        "ks-input",
        mono ? "ks-input--mono" : "",
        invalid ? "ks-input--invalid" : "",
        valid ? "ks-input--valid" : "",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    const input = (
        <input className={cls} aria-invalid={invalid || undefined} {...rest} />
    );

    if (!icon) return input;

    return (
        <span className="ks-input-wrap">
            <Icon name={icon} />
            {input}
        </span>
    );
}
