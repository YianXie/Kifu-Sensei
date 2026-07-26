import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import { useAuth } from "@/contexts/AuthContext";

export default function Logout() {
    const { logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        logout();
        navigate("/");
        toast.success("You have been logged out successfully!");
    }, [logout, navigate]);

    return null;
}
