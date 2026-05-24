import DashboardIcon from "@mui/icons-material/Dashboard";
import HomeIcon from "@mui/icons-material/Home";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import {
    Box,
    Divider,
    Drawer,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Tooltip,
} from "@mui/material";

import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";

const DRAWER_WIDTH = 220;

const navItems = [
    { label: "Home", icon: <HomeIcon />, to: "/" },
    { label: "Dashboard", icon: <DashboardIcon />, to: "/dashboard", protected: true },
];

const bottomItems = [
    { label: "Settings", icon: <SettingsIcon />, to: "/settings", protected: true },
    { label: "Profile", icon: <PersonIcon />, to: "/profile", protected: true },
];

export default function NavSidebar() {
    const { isAuthenticated, logout } = useAuth();
    const navigate = useNavigate();

    function handleNav(to: string) {
        navigate(to);
    }

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: DRAWER_WIDTH,
                flexShrink: 0,
                "& .MuiDrawer-paper": {
                    width: DRAWER_WIDTH,
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                },
            }}
        >
            <Box sx={{ px: 2, py: 2.5, fontWeight: 700, fontSize: "1.1rem", letterSpacing: 0.5 }}>
                Website Template
            </Box>

            <List dense>
                {navItems
                    .filter((item) => !item.protected || isAuthenticated)
                    .map((item) => (
                        <ListItem key={item.label} disablePadding>
                            <ListItemButton onClick={() => handleNav(item.to)}>
                                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
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
                            <ListItemButton onClick={() => handleNav(item.to)}>
                                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                                <ListItemText primary={item.label} />
                            </ListItemButton>
                        </ListItem>
                    ))}

                {isAuthenticated && (
                    <ListItem disablePadding>
                        <Tooltip title="Log out" placement="right">
                            <ListItemButton onClick={logout}>
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                    <LogoutIcon />
                                </ListItemIcon>
                                <ListItemText primary="Logout" />
                            </ListItemButton>
                        </Tooltip>
                    </ListItem>
                )}
            </List>
        </Drawer>
    );
}
