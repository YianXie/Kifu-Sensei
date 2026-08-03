import type { IconName } from "./Icon";
import Icon from "./Icon";

export type MenuItem = {
    label: string;
    icon?: IconName;
    danger?: boolean;
};

export type MenuEntry = MenuItem | "divider";

/** Dropdown surface for the account menu. Position it yourself. */
export default function Menu({
    items,
    onSelect,
    className = "",
}: {
    items: readonly MenuEntry[];
    onSelect?: (item: MenuItem) => void;
    className?: string;
}) {
    return (
        <div className={`ks-menu ${className}`.trim()} role="menu">
            {items.map((item, index) =>
                item === "divider" ? (
                    <div key={`d${index}`} className="ks-menu__divider" />
                ) : (
                    <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className={`ks-menu__item${item.danger ? " ks-menu__item--danger" : ""}`}
                        onClick={() => onSelect?.(item)}
                    >
                        {item.icon ? <Icon name={item.icon} /> : null}
                        {item.label}
                    </button>
                )
            )}
        </div>
    );
}
