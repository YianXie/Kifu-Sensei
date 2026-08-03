import type { ReactNode, SelectHTMLAttributes } from "react";

export type SelectOption = string | { value: string; label: ReactNode };

/** Native select, restyled. `options` accepts strings or {value,label}. */
export default function Select({
    options = [],
    children,
    invalid = false,
    className = "",
    ...rest
}: {
    options?: readonly SelectOption[];
    children?: ReactNode;
    invalid?: boolean;
} & SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            className={`ks-input ks-select${invalid ? " ks-input--invalid" : ""} ${className}`.trim()}
            aria-invalid={invalid || undefined}
            {...rest}
        >
            {children ??
                options.map((option) => {
                    const value =
                        typeof option === "string" ? option : option.value;
                    const label =
                        typeof option === "string" ? option : option.label;
                    return (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    );
                })}
        </select>
    );
}
