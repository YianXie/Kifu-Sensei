import { useRef } from "react";
import { useNavigate } from "react-router-dom";

import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CodeIcon from "@mui/icons-material/Code";
import EastIcon from "@mui/icons-material/East";
import TuneIcon from "@mui/icons-material/Tune";
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Container,
    Link,
    Stack,
    Typography,
} from "@mui/material";
import { keyframes, styled } from "@mui/material/styles";

import Demo from "@/components/home/Demo";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Subtle pulse for the CTA badge ──────────────────────────────────────────
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const HeroStack = styled(Stack)(({ theme }) => ({
    animation: `${fadeUp} 0.5s ease both`,
    [theme.breakpoints.down("lg")]: {
        textAlign: "center",
        alignItems: "center",
    },
}));

const GridLine = styled(Box)(({ theme }) => ({
    position: "absolute",
    inset: 0,
    backgroundImage: `
        linear-gradient(${theme.palette.divider} 1px, transparent 1px),
        linear-gradient(90deg, ${theme.palette.divider} 1px, transparent 1px)
    `,
    backgroundSize: "48px 48px",
    opacity: 0.35,
    pointerEvents: "none",
    zIndex: 0,
}));

const FeatureCard = styled(Card)(({ theme }) => ({
    flex: 1,
    minWidth: 240,
    borderRadius: 16,
    transition: "box-shadow 0.2s, transform 0.2s",
    "&:hover": {
        transform: "translateY(-3px)",
        boxShadow: theme.shadows[4],
    },
}));

const IconBadge = styled(Box)(({ theme }) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 12,
    flexShrink: 0,
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.action.hover,
}));

const features = [
    {
        icon: <AutoAwesomeIcon fontSize="small" />,
        title: "Natural language commentary",
        body: (
            <>
                Kifu-Sensei combines KataGo's numeric analysis with
                human-readable explanations powered by Claude. Instead of raw
                win-rate charts, you get a clear explanation of <em>why</em> a
                move was a mistake and what better alternatives exist.
            </>
        ),
    },
    {
        icon: <TuneIcon fontSize="small" />,
        title: "Fully customizable output",
        body: (
            <>
                Adjust the number of comments, choose your Claude model, set a
                token budget, and add custom instructions — all from the
                commentary page. Tailor the depth and style to match your level
                and budget.
            </>
        ),
    },
    {
        icon: <CodeIcon fontSize="small" />,
        title: "Open-source & affordable",
        body: (
            <>
                The frontend and website backend are fully{" "}
                <Link
                    href="https://github.com/YianXie/Kifu-Sensei"
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                >
                    open-source on GitHub
                </Link>
                . With prompt-caching, a 20-move commentary costs well under
                $0.10 — you only pay for your own Claude API key.
            </>
        ),
    },
];

export default function Home() {
    usePageTitle("Home");

    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const featuresRef = useRef<HTMLElement>(null);

    const handleLearnMore = () => {
        featuresRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    };

    return (
        <Box>
            {/* ── Hero ─────────────────────────────────────────────────────── */}
            <Box
                sx={{
                    position: "relative",
                    overflow: "hidden",
                    pt: { xs: 6, md: 8 },
                    pb: { xs: 6, md: 8 },
                }}
            >
                <GridLine />
                <Container
                    maxWidth="xl"
                    sx={{ position: "relative", zIndex: 1 }}
                >
                    <Box
                        sx={(theme) => ({
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: { xs: 4, lg: 8 },
                            [theme.breakpoints.down("lg")]: {
                                flexDirection: "column",
                            },
                        })}
                    >
                        {/* Left: copy */}
                        <HeroStack
                            spacing={3}
                            sx={{
                                width: "100%",
                                maxWidth: { xs: "100%", lg: 560 },
                                flexShrink: 0,
                            }}
                        >
                            <Chip
                                label="KataGo · Claude · SGF"
                                size="small"
                                variant="outlined"
                                sx={{
                                    width: "fit-content",
                                    fontWeight: 500,
                                    letterSpacing: 0.5,
                                }}
                            />

                            <Typography
                                component="h1"
                                sx={{
                                    fontWeight: 800,
                                    fontSize: {
                                        xs: "2rem",
                                        sm: "2.5rem",
                                        md: "3rem",
                                    },
                                    lineHeight: 1.15,
                                    letterSpacing: "-0.02em",
                                }}
                            >
                                Understand your mistakes{" "}
                                <Box
                                    component="span"
                                    sx={{ color: "primary.main" }}
                                >
                                    in words, not just numbers
                                </Box>
                            </Typography>

                            <Typography
                                variant="body1"
                                sx={{
                                    color: "text.secondary",
                                    fontSize: { xs: "1rem", md: "1.1rem" },
                                    lineHeight: 1.7,
                                    maxWidth: 480,
                                }}
                            >
                                Upload an SGF file and receive KataGo-backed
                                analysis paired with Claude-generated commentary
                                for every significant move.
                            </Typography>

                            <Stack
                                direction={{ xs: "column", sm: "row" }}
                                spacing={2}
                                sx={{
                                    pt: 1,
                                    alignItems: {
                                        xs: "stretch",
                                        lg: "flex-start",
                                    },
                                }}
                            >
                                {isAuthenticated ? (
                                    <Button
                                        variant="contained"
                                        size="large"
                                        endIcon={<EastIcon />}
                                        onClick={() => navigate("/commentary")}
                                        sx={{
                                            borderRadius: 2,
                                            fontWeight: 600,
                                        }}
                                    >
                                        Generate commentary
                                    </Button>
                                ) : (
                                    <Button
                                        variant="contained"
                                        size="large"
                                        endIcon={<EastIcon />}
                                        onClick={() => navigate("/login")}
                                        sx={{
                                            borderRadius: 2,
                                            fontWeight: 600,
                                        }}
                                    >
                                        Get started — it's free
                                    </Button>
                                )}
                                <Button
                                    variant="outlined"
                                    size="large"
                                    endIcon={<ArrowDownwardIcon />}
                                    onClick={handleLearnMore}
                                    sx={{ borderRadius: 2 }}
                                >
                                    See features
                                </Button>
                            </Stack>
                        </HeroStack>

                        {/* Right: demo board */}
                        <Box
                            sx={{
                                width: "100%",
                                borderRadius: 2,
                                overflow: "hidden",
                                flexShrink: 1,
                                mx: "auto",
                            }}
                        >
                            <Demo boardCanvasSize={600} />
                        </Box>
                    </Box>
                </Container>
            </Box>

            {/* ── Features ─────────────────────────────────────────────────── */}
            <Box
                component="section"
                ref={featuresRef}
                sx={{
                    bgcolor: "background.default",
                    borderTop: "1px solid",
                    borderColor: "divider",
                    py: { xs: 8, md: 10 },
                }}
            >
                <Container maxWidth="lg">
                    <Stack spacing={1} sx={{ mb: 6, alignItems: "center" }}>
                        <Typography
                            variant="overline"
                            sx={{
                                color: "primary.main",
                                letterSpacing: 2,
                                fontWeight: 700,
                            }}
                        >
                            Features
                        </Typography>
                        <Typography
                            variant="h4"
                            sx={{ fontWeight: 800, textAlign: "center" }}
                        >
                            Everything you need to improve
                        </Typography>
                        <Typography
                            variant="body1"
                            sx={{
                                color: "text.secondary",
                                textAlign: "center",
                                maxWidth: 480,
                            }}
                        >
                            A focused toolkit designed around the one thing most
                            Go analysis tools skip — plain language feedback.
                        </Typography>
                    </Stack>

                    <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={3}
                        sx={{ flexWrap: "wrap" }}
                        useFlexGap
                    >
                        {features.map(({ icon, title, body }) => (
                            <FeatureCard key={title} variant="outlined">
                                <CardContent sx={{ p: 3.5 }}>
                                    <Stack
                                        direction="row"
                                        spacing={1.75}
                                        sx={{ alignItems: "center", mb: 2 }}
                                    >
                                        <IconBadge>{icon}</IconBadge>
                                        <Typography
                                            variant="h6"
                                            sx={{
                                                fontWeight: 700,
                                                lineHeight: 1.25,
                                            }}
                                        >
                                            {title}
                                        </Typography>
                                    </Stack>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            color: "text.secondary",
                                            lineHeight: 1.75,
                                        }}
                                    >
                                        {body}
                                    </Typography>
                                </CardContent>
                            </FeatureCard>
                        ))}
                    </Stack>
                </Container>
            </Box>

            {/* ── CTA banner ───────────────────────────────────────────────── */}
            <Box
                sx={{
                    borderTop: "1px solid",
                    borderColor: "divider",
                    py: { xs: 8, md: 10 },
                    textAlign: "center",
                }}
            >
                <Container maxWidth="sm">
                    <Typography
                        variant="overline"
                        sx={{
                            color: "primary.main",
                            letterSpacing: 2,
                            fontWeight: 700,
                        }}
                    >
                        Ready?
                    </Typography>
                    <Typography
                        variant="h4"
                        sx={{ fontWeight: 800, mt: 1, mb: 2 }}
                    >
                        Start analyzing your games today
                    </Typography>
                    <Typography
                        variant="body1"
                        sx={{ color: "text.secondary", mb: 4 }}
                    >
                        A 20-move commentary costs less than $0.10. Upload your
                        first SGF and see the difference.
                    </Typography>
                    <Button
                        variant="contained"
                        size="large"
                        endIcon={<EastIcon />}
                        onClick={() =>
                            navigate(isAuthenticated ? "/commentary" : "/login")
                        }
                        sx={{ borderRadius: 2, fontWeight: 600, px: 4 }}
                    >
                        {isAuthenticated
                            ? "Generate commentary"
                            : "Create a free account"}
                    </Button>
                </Container>
            </Box>
        </Box>
    );
}
