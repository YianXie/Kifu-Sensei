import { Box } from "@mui/material";

import { Outlet } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import NavSidebar from "@/components/NavSidebar";

export default function Layout() {
    return (
        <Box sx={{ display: "flex", minHeight: "100vh" }}>
            <NavSidebar />
            <Box component="main" sx={{ flexGrow: 1, p: 3, overflow: "auto" }}>
                <Outlet />
            </Box>
            <ToastContainer position="bottom-right" autoClose={3000} theme="colored" />
        </Box>
    );
}
