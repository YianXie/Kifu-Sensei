import type { ReactNode } from "react";

/**
 * Label + control + hint/error wrapper. Every form control in the product is
 * wrapped in one of these; the label is the uppercase mono micro-label.
 */
export default function Field({
    label,
    hint,
    error,
    required = false,
    htmlFor,
    block = true,
    children,
    className = "",
}: {
    label?: ReactNode;
    hint?: ReactNode;
    /** Replaces `hint` when set. */
    error?: ReactNode;
    required?: boolean;
    htmlFor?: string;
    block?: boolean;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`ks-field${block ? " ks-field--block" : ""} ${className}`.trim()}
        >
            {label ? (
                <label className="ks-field__label" htmlFor={htmlFor}>
                    {label}
                    {required ? (
                        <span className="ks-field__required">*</span>
                    ) : null}
                </label>
            ) : null}
            {children}
            {error ? (
                <span className="ks-field__error">{error}</span>
            ) : hint ? (
                <span className="ks-field__hint">{hint}</span>
            ) : null}
        </div>
    );
}
