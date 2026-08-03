import Icon, { type IconName } from "./Icon";

export type SegmentedOption<T extends string> = {
    value: T;
    label: string;
    icon?: IconName;
};

/** Small exclusive choice, rendered as a segmented control. */
export default function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    className = "",
}: {
    options: readonly SegmentedOption<T>[];
    value: T;
    onChange?: (value: T) => void;
    ariaLabel?: string;
    className?: string;
}) {
    return (
        <div
            className={`ks-segmented ${className}`.trim()}
            role="radiogroup"
            aria-label={ariaLabel}
        >
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    className="ks-segmented__option"
                    onClick={() => onChange?.(option.value)}
                >
                    {option.icon ? <Icon name={option.icon} size="sm" /> : null}
                    {option.label}
                </button>
            ))}
        </div>
    );
}
