import type { TextareaHTMLAttributes } from "react";

/** Multi-line input. Used for the custom-instruction box. */
export default function Textarea({
    rows = 4,
    invalid = false,
    className = "",
    ...rest
}: {
    invalid?: boolean;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            rows={rows}
            className={`ks-input ks-input--textarea${invalid ? " ks-input--invalid" : ""} ${className}`.trim()}
            aria-invalid={invalid || undefined}
            {...rest}
        />
    );
}
