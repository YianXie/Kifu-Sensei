import { Box, Button, Container, Typography } from "@mui/material";

import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Home() {
    usePageTitle("Home");
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();

    return (
        <Container maxWidth="md">
            <Box className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
                <Typography variant="h2" component="h1" fontWeight={700}>
                    Website Template
                </Typography>
                <Typography variant="h6" color="text.secondary" maxWidth={480}>
                    A production-ready Django REST Framework + React starter. Replace this copy with
                    your own project description.
                </Typography>
                <Box className="flex gap-4">
                    {isAuthenticated ? (
                        <Button
                            variant="contained"
                            size="large"
                            onClick={() => navigate("/dashboard")}
                        >
                            Go to Dashboard
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="contained"
                                size="large"
                                onClick={() => navigate("/register")}
                            >
                                Get Started
                            </Button>
                            <Button
                                variant="outlined"
                                size="large"
                                onClick={() => navigate("/login")}
                            >
                                Log In
                            </Button>
                        </>
                    )}
                </Box>
            </Box>
        </Container>
    );
}
