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
                <Typography variant="body1" lineHeight={1.5}>
                    Kifu-Sensei is an automated LLM-based tool that generates
                    move-by-move commentary for Go games. It uses KataGo to
                    analyze the game and Claude to generate the commentary. It
                    is also an open-source project and is available on{" "}
                    <Link
                        href="https://github.com/YianXie/Kifu-Sensei"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        GitHub
                    </Link>
                    .
                </Typography>
                <Typography variant="body1" lineHeight={1.5}>
                    To start using Kifu-Sensei, simply follow the{" "}
                    <Link
                        href="https://platform.claude.com/settings/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        instructions
                    </Link>{" "}
                    to create a Claude API key. Then, go to the settings page
                    and paste the API key into the input field. Finally, go to
                    the Commentary page and upload your SGF file.
                </Typography>
            </Stack>

            <Demo />
        </Container>
    );
}
