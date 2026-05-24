import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute() {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) return null;
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return <Outlet />;
}
