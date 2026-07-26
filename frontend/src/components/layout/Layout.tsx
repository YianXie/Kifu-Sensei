import { Outlet } from "react-router";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { Box } from "@mui/material";

import Navbar from "./Navbar";

export default function Layout() {
    return (
        <Box sx={{ minHeight: "100vh" }}>
            <Navbar />
            <Box
                component="main"
                sx={{
                    p: 3,
                    overflow: "auto",
                    mt: 7,
                }}
            >
                <Outlet />
            </Box>

            <ToastContainer
                position="bottom-right"
                autoClose={3000}
                theme="colored"
            />
        </Box>
    );
}
