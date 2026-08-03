import type { InputHTMLAttributes, ReactNode } from "react";

/** Binary preference toggle. */
export default function Switch({
    label,
    className = "",
    ...rest
}: {
    label?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
    return (
        <label className={`ks-switch ${className}`.trim()}>
            <input type="checkbox" {...rest} />
            <span className="ks-switch__track">
                <span className="ks-switch__thumb" />
            </span>
            {label ? <span>{label}</span> : null}
        </label>
    );
}
