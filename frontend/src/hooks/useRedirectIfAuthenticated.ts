import { useEffect } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/contexts/AuthContext";

export function useRedirectIfAuthenticated(to = "/") {
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (isAuthenticated) {
            navigate(to, { replace: true });
        }
    }, [isAuthenticated, navigate, to]);
}
