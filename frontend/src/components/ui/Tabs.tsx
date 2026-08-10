/**
 * Underlined section tabs — Settings uses Account / Default commentary config /
 * Miscellaneous.
 */
export default function Tabs<T extends string>({
    tabs,
    value,
    onChange,
    className = "",
}: {
    tabs: readonly T[];
    value: T;
    onChange?: (value: T) => void;
    className?: string;
}) {
    return (
        <div className={`ks-tabs ${className}`.trim()} role="tablist">
            {tabs.map((tab) => (
                <button
                    key={tab}
                    type="button"
                    role="tab"
                    className="ks-tab"
                    aria-selected={value === tab}
                    tabIndex={value === tab ? 0 : -1}
                    onClick={() => onChange?.(tab)}
                >
                    {tab}
                </button>
            ))}
        </div>
    );
}
