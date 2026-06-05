import { useRef } from "react";
import { useNavigate } from "react-router-dom";

import {
    Box,
    Button,
    Card,
    CardContent,
    Container,
    Divider,
    Link,
    Stack,
    Typography,
} from "@mui/material";

import Demo from "@/components/about/Demo";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Home() {
    usePageTitle("Home");

    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const featuresRef = useRef<HTMLElement>(null);

    const handleLearnMore = () => {
        if (featuresRef.current) {
            featuresRef.current.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "nearest",
            });
        }
    };

    return (
        <Container maxWidth="xl" sx={{ pb: 4 }}>
            {/* Hero */}
            <Box
                sx={(theme) => ({
                    display: "flex",
                    flexDirection: "row",
                    gap: 2,
                    [theme.breakpoints.down("lg")]: {
                        flexDirection: "column",
                        alignItems: "center",
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
                        Understand your mistakes in languages, not just numbers
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
                            gap: 2,
                            pt: 2,
                            [theme.breakpoints.down("md")]: {
                                flexDirection: "column",
                                alignItems: "center",
                            },
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
                            onClick={handleLearnMore}
                        >
                            Learn more
                        </Button>
                    </Box>
                </Stack>

                <Box sx={{ width: "100%", maxWidth: 800 }}>
                    <Demo boardCanvasSize={600} />
                </Box>
            </Box>

            <Divider flexItem sx={{ my: 4 }} />

            {/* Learn more section */}
            <Box ref={featuresRef}>
                <Typography
                    variant="h5"
                    sx={{ fontWeight: 700, textAlign: "center" }}
                >
                    Features
                </Typography>
                <Stack direction="row" spacing={4} sx={{ mt: 4 }}>
                    <Card variant="outlined" sx={{ flex: 1 }}>
                        <CardContent>
                            <Typography variant="h6">
                                Natural language explanation
                            </Typography>
                            <Typography sx={{ mt: 1 }}>
                                Kifu-Sensei is the world's first attempt in
                                utilizing LLMs to generate comments for go. It
                                combines numbers — which is what most platforms
                                offer and only offer — with natural, human
                                understandable languages. By using its
                                customized KataGo two-pass policy, we prioritize
                                analyzing bad moves, providing you with feedback
                                on your and your opponent's mistakes.
                            </Typography>
                        </CardContent>
                    </Card>
                    <Card variant="outlined" sx={{ flex: 1 }}>
                        <CardContent>
                            <Typography variant="h6">
                                Customizable output
                            </Typography>
                            <Typography sx={{ mt: 1 }}>
                                You can easily modify the number of commentary,
                                Claude model, max token, and custom instructions
                                in the commentary page. As a result, you get a
                                more personalized output based on your needs and
                                budgets.
                            </Typography>
                        </CardContent>
                    </Card>
                    <Card variant="outlined" sx={{ flex: 1 }}>
                        <CardContent>
                            <Typography variant="h6">
                                Cheap and open-source
                            </Typography>
                            <Typography sx={{ mt: 1 }}>
                                Kifu-Sensei is almost entirely open-source, with
                                only the backend code on AWS remains private.
                                All source code of the website, both frontend
                                and backend, can be found on the{" "}
                                <Link
                                    href="https://github.com/YianXie/Kifu-Sensei"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    official GitHub repository
                                </Link>
                                . That way, the only thing you have to pay for
                                is your Claude API key. With prompt-caching, a
                                20-move commentary costs well less than $0.10.
                            </Typography>
                        </CardContent>
                    </Card>
                </Stack>
            </Box>

            <Divider flexItem sx={{ my: 4 }} />

            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                }}
            >
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    Ready to generate commentary?
                </Typography>
                <Button
                    variant="contained"
                    onClick={() => navigate("/commentary")}
                    sx={{ mt: 4, width: "fit-content" }}
                >
                    Get started
                </Button>
            </Box>
        </Container>
    );
}
