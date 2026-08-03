import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import {
    Button,
    Drawer,
    IconButton,
    Menu,
    type MenuEntry,
    NavList,
    type NavListItem,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/** Links that sit directly in the bar on desktop. */
const PUBLIC_LINKS: NavListItem[] = [
    { label: "Privacy", to: "/privacy", icon: "policy" },
];
const PRIVATE_LINKS: NavListItem[] = [
    { label: "Commentary", to: "/commentary", icon: "comment" },
    { label: "History", to: "/history", icon: "history" },
];

const ACCOUNT_MENU: MenuEntry[] = [
    { label: "Settings", icon: "settings" },
    { label: "History", icon: "history" },
    "divider",
    { label: "Logout", icon: "logout", danger: true },
];

const MENU_TARGETS: Record<string, string> = {
    Settings: "/settings",
    History: "/history",
    Logout: "/logout",
};

export default function Navbar() {
    const { isAuthenticated } = useAuth();
    const { resolved, toggle } = useTheme();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const isMobile = useMediaQuery("(max-width: 768px)");

    const [drawerOpen, setDrawerOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const accountRef = useRef<HTMLDivElement>(null);

    const links = isAuthenticated
        ? [...PRIVATE_LINKS, ...PUBLIC_LINKS]
        : PUBLIC_LINKS;
    const drawerItems: NavListItem[] = [
        ...links,
        ...(isAuthenticated
            ? [
                  {
                      label: "Settings",
                      to: "/settings",
                      icon: "settings",
                  } as const,
                  { label: "Logout", to: "/logout", icon: "logout" } as const,
              ]
            : [{ label: "Login", to: "/login", icon: "login" } as const]),
    ];

    // The account dropdown is positioned, not portalled, so a click anywhere
    // else has to close it explicitly.
    useEffect(() => {
        if (!menuOpen) return;
        function handlePointerDown(event: MouseEvent) {
            if (!accountRef.current?.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") setMenuOpen(false);
        }
        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [menuOpen]);

    return (
        <div style={{ position: "relative", zIndex: 40 }}>
            <header className="ks-navbar">
                <Link className="ks-navbar__brand" to="/">
                    <img
                        className="ks-navbar__logo"
                        src="/logo.png"
                        alt=""
                        width={30}
                        height={30}
                    />
                    <span className="ks-navbar__wordmark">Kifu-Sensei</span>
                </Link>

                {!isMobile && (
                    <nav className="ks-navbar__links">
                        {links.map((link) => (
                            <Link
                                key={link.label}
                                className="ks-navbar__link"
                                to={link.to}
                                aria-current={
                                    pathname === link.to ? "page" : undefined
                                }
                            >
                                {link.label}
                            </Link>
                        ))}
                    </nav>
                )}

                <div className="ks-navbar__actions">
                    <IconButton
                        icon={resolved === "dark" ? "light_mode" : "dark_mode"}
                        label={
                            resolved === "dark"
                                ? "Switch to light theme"
                                : "Switch to dark theme"
                        }
                        onClick={toggle}
                    />

                    {isMobile ? (
                        <IconButton
                            icon="menu"
                            label="Open navigation menu"
                            onClick={() => setDrawerOpen(true)}
                        />
                    ) : isAuthenticated ? (
                        <div ref={accountRef}>
                            <IconButton
                                icon="account_circle"
                                label="Account"
                                size="lg"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                onClick={() => setMenuOpen((open) => !open)}
                            />
                        </div>
                    ) : (
                        <Button size="sm" onClick={() => navigate("/login")}>
                            Log in
                        </Button>
                    )}
                </div>
            </header>

            {menuOpen && (
                <div
                    style={{
                        position: "absolute",
                        right: 24,
                        top: 56,
                        zIndex: 60,
                    }}
                >
                    <Menu
                        items={ACCOUNT_MENU}
                        onSelect={(item) => {
                            setMenuOpen(false);
                            navigate(MENU_TARGETS[item.label] ?? "/");
                        }}
                    />
                </div>
            )}

            <Drawer
                open={drawerOpen}
                title="Kifu-Sensei"
                onClose={() => setDrawerOpen(false)}
            >
                <NavList
                    items={drawerItems}
                    current={pathname}
                    onSelect={() => setDrawerOpen(false)}
                />
            </Drawer>
        </div>
    );
}
