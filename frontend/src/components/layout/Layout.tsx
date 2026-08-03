import { Outlet } from "react-router";
import { ToastContainer } from "react-toastify";

import Footer from "./Footer";
import Navbar from "./Navbar";

export default function Layout() {
    return (
        <div className="ks-app">
            <Navbar />
            <main className="ks-app__main">
                <Outlet />
            </main>
            <Footer />

            {/* react-toastify's stylesheet and the design system's skin for it
                are both imported from `src/index.css`, in that order. */}
            <ToastContainer position="bottom-right" autoClose={3800} />
        </div>
    );
}
