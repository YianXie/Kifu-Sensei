import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import { AccountCircle } from "@mui/icons-material";
import CommentIcon from "@mui/icons-material/Comment";
import HistoryIcon from "@mui/icons-material/History";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import SettingsIcon from "@mui/icons-material/Settings";
import {
    AppBar,
    Box,
    Button,
    Drawer,
    IconButton,
    Link,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    Menu,
    MenuItem,
    Toolbar,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";

import { useAuth } from "@/contexts/AuthContext";

export default function Navbar() {
    const { isAuthenticated } = useAuth();

    const [drawerOpen, setDrawerOpen] = useState(false);
    const [authAnchorEl, setAuthAnchorEl] = useState<HTMLElement | null>(null);

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

    const navItems = [
        {
            label: "Commentary",
            to: "/commentary",
            protected: true,
            icon: <CommentIcon />,
        },
    ];
    const authItems = [
        {
            label: "Settings",
            to: "/settings",
            protected: true,
            icon: <SettingsIcon />,
        },
        {
            label: "History",
            to: "/history",
            protected: true,
            icon: <HistoryIcon />,
        },
    ];

    const drawerContent = (
        <Box>
            <List sx={{ px: 2 }}>
                {[...navItems, ...authItems]
                    .filter((item) => isAuthenticated || !item.protected)
                    .map((item) => (
                        <ListItem
                            key={item.label}
                            sx={{
                                fontWeight: 500,
                            }}
                        >
                            <ListItemButton>
                                <ListItemIcon>{item.icon}</ListItemIcon>
                                <Link
                                    component={RouterLink}
                                    to={item.to}
                                    underline="none"
                                    color="inherit"
                                >
                                    {item.label}
                                </Link>
                            </ListItemButton>
                        </ListItem>
                    ))}
                <ListItem
                    sx={{
                        fontWeight: 500,
                    }}
                >
                    {isAuthenticated ? (
                        <ListItemButton>
                            <ListItemIcon>
                                <LogoutIcon />
                            </ListItemIcon>
                            <Link
                                component={RouterLink}
                                to="/logout"
                                underline="none"
                                color="inherit"
                            >
                                Logout
                            </Link>
                        </ListItemButton>
                    ) : (
                        <ListItemButton>
                            <ListItemIcon>
                                <LoginIcon />
                            </ListItemIcon>
                            <Link
                                component={RouterLink}
                                to="/login"
                                underline="none"
                                color="inherit"
                            >
                                Login
                            </Link>
                        </ListItemButton>
                    )}
                </ListItem>
            </List>
        </Box>
    );

    const handleAuthMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAuthAnchorEl(event.currentTarget);
    };

    const handleAuthMenuClose = () => {
        setAuthAnchorEl(null);
    };

    return (
        <AppBar
            position="static"
            sx={{
                px: 2,
                py: 1,
                userSelect: "none",
            }}
        >
            <Toolbar variant="dense">
                <Link
                    to="/"
                    component={RouterLink}
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        cursor: "pointer",
                        mr: 4,
                        flexGrow: isMobile ? 1 : "initial",
                    }}
                    underline="none"
                    color="inherit"
                >
                    <img src="/logo.png" alt="Kifu-Sensei" height={32} />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        Kifu-Sensei
                    </Typography>
                </Link>
                {isMobile ? (
                    <>
                        <IconButton onClick={() => setDrawerOpen(true)}>
                            <MenuIcon
                                sx={{
                                    color: "#fff",
                                }}
                            />
                        </IconButton>
                        <Drawer
                            anchor="right"
                            open={drawerOpen}
                            onClick={() => setDrawerOpen(false)}
                            onClose={() => setDrawerOpen(false)}
                        >
                            {drawerContent}
                        </Drawer>
                    </>
                ) : (
                    <>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                                flexGrow: 1,
                            }}
                        >
                            {navItems
                                .filter(
                                    (item) => isAuthenticated || !item.protected
                                )
                                .map((item) => (
                                    <Link
                                        key={item.label}
                                        to={item.to}
                                        component={RouterLink}
                                        color="inherit"
                                        underline="hover"
                                    >
                                        {item.label}
                                    </Link>
                                ))}
                        </Box>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                            }}
                        >
                            {isAuthenticated ? (
                                <Box>
                                    <IconButton
                                        size="medium"
                                        aria-label="account"
                                        aria-controls="auth-menu"
                                        aria-haspopup="true"
                                        onClick={handleAuthMenuOpen}
                                        color="inherit"
                                    >
                                        <AccountCircle fontSize="large" />
                                    </IconButton>
                                    <Menu
                                        id="auth-menu"
                                        anchorEl={authAnchorEl}
                                        anchorOrigin={{
                                            vertical: "bottom",
                                            horizontal: "right",
                                        }}
                                        keepMounted
                                        transformOrigin={{
                                            vertical: "top",
                                            horizontal: "right",
                                        }}
                                        open={Boolean(authAnchorEl)}
                                        onClose={handleAuthMenuClose}
                                    >
                                        {authItems.map((item) => (
                                            <MenuItem
                                                key={item.label}
                                                onClick={handleAuthMenuClose}
                                            >
                                                <Link
                                                    key={item.label}
                                                    to={item.to}
                                                    component={RouterLink}
                                                    color="inherit"
                                                    underline="none"
                                                >
                                                    {item.label}
                                                </Link>
                                            </MenuItem>
                                        ))}
                                        <MenuItem onClick={handleAuthMenuClose}>
                                            <Link
                                                to="/logout"
                                                component={RouterLink}
                                                color="inherit"
                                                underline="none"
                                            >
                                                Logout
                                            </Link>
                                        </MenuItem>
                                    </Menu>
                                </Box>
                            ) : (
                                <Link
                                    to="/login"
                                    component={RouterLink}
                                    color="inherit"
                                    underline="hover"
                                >
                                    <Button
                                        variant="contained"
                                        color="secondary"
                                    >
                                        Login
                                    </Button>
                                </Link>
                            )}
                        </Box>
                    </>
                )}
            </Toolbar>
        </AppBar>
    );
}
