import { useNavigate } from "react-router-dom";

import { Box, Button, Container, Typography } from "@mui/material";

import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Home() {
    usePageTitle("Home");
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();

    return (
        <Container maxWidth="md">
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    minHeight: "70vh",
                    textAlign: "center",
                }}
            >
                <Typography variant="h2" component="h1" fontWeight={700}>
                    Kifu-Sensei
                </Typography>
                <Typography variant="h6" color="text.secondary" maxWidth={480}>
                    An automated LLM-based Go game commentary generator
                </Typography>
                <Box sx={{ display: "flex", gap: 2 }}>
                    {isAuthenticated ? (
                        <Button
                            variant="contained"
                            size="large"
                            onClick={() => navigate("/")}
                        >
                            Go to commentary page
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
