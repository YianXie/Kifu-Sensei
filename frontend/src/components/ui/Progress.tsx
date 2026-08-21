/**
 * A determinate or indeterminate progress bar.
 *
 * The CSS has been in the design system since it was written — and its own comment
 * says it came "from the extension's generating screen" — but nothing on the website
 * rendered it, because the web app had no real progress to report.
 */
export default function Progress({
    value,
    max = 100,
    label,
    valueText,
}: {
    /** Omit for indeterminate: something is happening, but not how much of it. */
    value?: number;
    max?: number;
    label: string;
    /** What a screen reader should say instead of a bare percentage. */
    valueText?: string;
}) {
    const indeterminate = value === undefined;
    const percent = indeterminate
        ? 0
        : Math.max(0, Math.min(100, Math.round((value / max) * 100)));

    return (
        <div
            className={`ks-progress${indeterminate ? " ks-progress--indeterminate" : ""}`}
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : percent}
            aria-valuetext={valueText}
        >
            <div
                className="ks-progress__fill"
                style={indeterminate ? undefined : { width: `${percent}%` }}
            />
        </div>
    );
}
