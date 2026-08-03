import { Link } from "react-router";

import Icon, { type IconName } from "./Icon";

export type NavListItem = {
    label: string;
    to: string;
    icon?: IconName;
};

/**
 * Vertical link list with leading glyphs — the drawer's contents.
 *
 * Rows are real router links rather than buttons, so the whole row (glyph
 * included) is one click target and middle-click / open-in-new-tab still work.
 */
export default function NavList({
    items,
    current,
    onSelect,
    className = "",
}: {
    items: readonly NavListItem[];
    /** `to` of the row representing the current page. */
    current?: string;
    onSelect?: (item: NavListItem) => void;
    className?: string;
}) {
    return (
        <ul className={`ks-navlist ${className}`.trim()}>
            {items.map((item) => (
                <li key={item.label}>
                    <Link
                        className="ks-navlist__item"
                        to={item.to}
                        aria-current={current === item.to ? "page" : undefined}
                        onClick={() => onSelect?.(item)}
                    >
                        {item.icon ? <Icon name={item.icon} /> : null}
                        {item.label}
                    </Link>
                </li>
            ))}
        </ul>
    );
}
