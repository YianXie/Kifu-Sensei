import { useNavigate } from "react-router-dom";

import GridOffRoundedIcon from "@mui/icons-material/GridOffRounded";
import {
    Box,
    Button,
    Container,
    Stack,
    Typography,
    alpha,
} from "@mui/material";

import { usePageTitle } from "@/hooks/usePageTitle";

/** Lightweight decorative mini-board suggesting “nothing landed here”. */
function DecorativeMiniBoard() {
    return (
        <Box
            sx={(theme) => {
                const line = alpha(theme.palette.divider, 0.95);
                return {
                    position: "relative",
                    width: 144,
                    height: 144,
                    mx: "auto",
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: alpha(
                        theme.palette.mode === "dark"
                            ? theme.palette.grey[900]
                            : theme.palette.grey[100],
                        0.65
                    ),
                    backgroundImage: `
                  repeating-linear-gradient(
                    0deg,
                    transparent,
                    transparent 17px,
                    ${line} 17px,
                    ${line} 18px
                  ),
                  repeating-linear-gradient(
                    90deg,
                    transparent,
                    transparent 17px,
                    ${line} 17px,
                    ${line} 18px
                  )
                `,
                };
            }}
            aria-hidden
        >
            <Box
                sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    border: "2px dashed",
                    borderColor: "text.secondary",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "background.paper",
                }}
            >
                <GridOffRoundedIcon sx={{ fontSize: 22, opacity: 0.7 }} />
            </Box>
        </Box>
    );
}

export default function NotFound() {
    usePageTitle("Page not found");
    const navigate = useNavigate();

    return (
        <Container maxWidth="sm">
            <Box
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 3,
                    minHeight: "60vh",
                    textAlign: "center",
                    py: 4,
                }}
            >
                <DecorativeMiniBoard />

                <Typography
                    variant="overline"
                    sx={{ letterSpacing: 4, color: "text.secondary" }}
                >
                    Error 404
                </Typography>

                <Typography variant="h4" component="h1" fontWeight={700}>
                    Page not found
                </Typography>

                <Typography
                    variant="body1"
                    color="text.secondary"
                    maxWidth={420}
                >
                    That URL isn&apos;t part of Kifu-Sensei—like a move outside
                    the board lines. Double-check the address or head back home.
                </Typography>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <Button
                        variant="contained"
                        size="large"
                        onClick={() => navigate("/home")}
                    >
                        Back to home
                    </Button>
                    <Button
                        variant="outlined"
                        size="large"
                        onClick={() => navigate(-1)}
                    >
                        Go back
                    </Button>
                </Stack>
            </Box>
        </Container>
    );
}
