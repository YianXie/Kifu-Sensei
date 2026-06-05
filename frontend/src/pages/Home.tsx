import { useNavigate } from "react-router-dom";

import { Box, Button, Container, Stack, Typography } from "@mui/material";

import Demo from "@/components/about/Demo";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Home() {
    usePageTitle("Home");

    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();

    return (
        <Container maxWidth="xl">
            {/* Hero */}
            <Box
                sx={(theme) => ({
                    display: "flex",
                    flexDirection: "row",
                    gap: 2,
                    [theme.breakpoints.down("lg")]: {
                        flexDirection: "column",
                        gap: 4,
                    },
                })}
            >
                <Stack
                    spacing={2}
                    sx={(theme) => ({
                        width: "100%",
                        maxWidth: 600,
                        [theme.breakpoints.down("lg")]: {
                            textAlign: "center",
                            alignItems: "center",
                        },
                    })}
                >
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        Go analysis that speaks your language
                    </Typography>
                    <Typography
                        variant="body1"
                        sx={{
                            fontWeight: 500,
                            color: (theme) => theme.palette.text.secondary,
                        }}
                    >
                        Upload an SGF file and get KataGo-backed analysis with
                        Claude-generated commentary for every significant move.
                    </Typography>
                    <Box
                        sx={(theme) => ({
                            display: "flex",
                            flexDirection: "row",
                            [theme.breakpoints.down("md")]: {
                                flexDirection: "column",
                                alignItems: "center",
                            },
                            gap: 2,
                            pt: 2,
                        })}
                    >
                        {isAuthenticated ? (
                            <Button
                                variant="contained"
                                sx={{ width: "fit-content" }}
                                onClick={() => navigate("/commentary")}
                            >
                                Generate commentary
                            </Button>
                        ) : (
                            <Button
                                variant="contained"
                                sx={{ width: "fit-content" }}
                                onClick={() => navigate("/login")}
                            >
                                Get started
                            </Button>
                        )}
                        <Button
                            variant="outlined"
                            sx={{ width: "fit-content" }}
                        >
                            Learn more
                        </Button>
                    </Box>
                </Stack>

                <Box sx={{ width: "100%", maxWidth: 800 }}>
                    <Demo boardCanvasSize={600} />
                </Box>
            </Box>
        </Container>
    );
}
