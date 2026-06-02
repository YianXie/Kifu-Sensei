import { useLocation, useNavigate } from "react-router-dom";

import CommentIcon from "@mui/icons-material/Comment";
import HomeIcon from "@mui/icons-material/Home";
import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import {
    Box,
    Divider,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
} from "@mui/material";

import { useAuth } from "@/contexts/AuthContext";

export const DRAWER_WIDTH = 220;

const navItems = [
    {
        label: "Home",
        icon: <HomeIcon />,
        to: "/home",
        protected: false,
        visitorOnly: true,
    },
    {
        label: "Commentary",
        icon: <CommentIcon />,
        to: "/",
        protected: true,
        visitorOnly: false,
    },
];

const bottomItems = [
    {
        label: "Settings",
        icon: <SettingsIcon />,
        to: "/settings",
        protected: true,
        visitorOnly: false,
    },
];

const drawerPaperSx = {
    width: DRAWER_WIDTH,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
} as const;

interface NavSidebarProps {
    mobileOpen: boolean;
    onMobileClose: () => void;
}

interface NavDrawerContentProps {
    onNavigate: (to: string) => void;
    onAfterAction?: () => void;
}

function NavDrawerContent({
    onNavigate,
    onAfterAction,
}: NavDrawerContentProps) {
    const { isAuthenticated, logout } = useAuth();
    const location = useLocation();

    function isActive(to: string) {
        return location.pathname === to;
    }

    function handleLogout() {
        logout();
        onAfterAction?.();
    }

    return (
        <>
            <Box
                sx={{
                    px: 2,
                    py: 2.5,
                    fontWeight: 700,
                    fontSize: "1.1rem",
                    letterSpacing: 0.5,
                }}
            >
                Kifu-Sensei
            </Box>

            <List dense>
                {navItems
                    .filter((item) => !item.protected || isAuthenticated)
                    .filter((item) =>
                        isAuthenticated ? !item.visitorOnly : true
                    )
                    .map((item) => (
                        <ListItem key={item.label} disablePadding>
                            <ListItemButton
                                selected={isActive(item.to)}
                                onClick={() => onNavigate(item.to)}
                            >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                    {item.icon}
                                </ListItemIcon>
                                <ListItemText primary={item.label} />
                            </ListItemButton>
                        </ListItem>
                    ))}
            </List>

            <Box sx={{ flexGrow: 1 }} />
            <Divider />

            <List dense>
                {bottomItems
                    .filter((item) => !item.protected || isAuthenticated)
                    .map((item) => (
                        <ListItem key={item.label} disablePadding>
                            <ListItemButton
                                selected={isActive(item.to)}
                                onClick={() => onNavigate(item.to)}
                            >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                    {item.icon}
                                </ListItemIcon>
                                <ListItemText primary={item.label} />
                            </ListItemButton>
                        </ListItem>
                    ))}

                {isAuthenticated && (
                    <ListItem disablePadding>
                        <ListItemButton onClick={handleLogout}>
                            <ListItemIcon sx={{ minWidth: 36 }}>
                                <LogoutIcon />
                            </ListItemIcon>
                            <ListItemText primary="Logout" />
                        </ListItemButton>
                    </ListItem>
                )}
            </List>
        </>
    );
}

export default function NavSidebar({
    mobileOpen,
    onMobileClose,
}: NavSidebarProps) {
    const navigate = useNavigate();

    function handleNavigate(to: string) {
        if (to) {
            navigate(to);
        }
        onMobileClose();
    }

    return (
        <Box
            component="nav"
            sx={{
                width: { md: DRAWER_WIDTH },
                flexShrink: { md: 0 },
            }}
        >
            <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={onMobileClose}
                ModalProps={{ keepMounted: true }}
                sx={{
                    display: { xs: "block", md: "none" },
                    "& .MuiDrawer-paper": drawerPaperSx,
                }}
            >
                <NavDrawerContent
                    onNavigate={handleNavigate}
                    onAfterAction={onMobileClose}
                />
            </Drawer>

            <Drawer
                variant="permanent"
                sx={{
                    display: { xs: "none", md: "block" },
                    "& .MuiDrawer-paper": drawerPaperSx,
                }}
                open
            >
                <NavDrawerContent onNavigate={(to) => navigate(to)} />
            </Drawer>
        </Box>
    );
}
