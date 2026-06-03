import { Container, Link, Stack, Typography } from "@mui/material";

import Demo from "@/components/about/Demo";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function About() {
    usePageTitle("About");

    return (
        <Container maxWidth="lg">
            <Stack spacing={2}>
                <Typography variant="h4" fontWeight={700} textAlign="center">
                    About
                </Typography>
                <Typography variant="body1">
                    Kifu-Sensei is an automated LLM-based tool that generates
                    move-by-move commentary for Go games. It uses KataGo to
                    analyze the game and Claude to generate the commentary.
                </Typography>
                <Typography variant="body1">
                    It is also an open-source project and is available on{" "}
                    <Link
                        href="https://github.com/YianXie/Kifu-Sensei"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        GitHub
                    </Link>
                    .
                </Typography>
            </Stack>

            <Demo />
        </Container>
    );
}
