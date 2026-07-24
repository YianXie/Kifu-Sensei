import ReactMarkdown from "react-markdown";

import {
    Box,
    Container,
    Divider,
    Link,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";

import remarkGfm from "remark-gfm";

import privacyPolicy from "@/content/privacy-policy.md?raw";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Privacy() {
    usePageTitle("Privacy Policy");

    return (
        <Container maxWidth="md" sx={{ py: { xs: 2, md: 4 } }}>
            <Box
                component="article"
                sx={{
                    "& > :first-of-type": { mt: 0 },
                }}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        h1: ({ children }) => (
                            <Typography
                                variant="h3"
                                component="h1"
                                sx={{ fontWeight: 700, mb: 2 }}
                            >
                                {children}
                            </Typography>
                        ),
                        h2: ({ children }) => (
                            <Typography
                                variant="h5"
                                component="h2"
                                sx={{ fontWeight: 700, mt: 4, mb: 1.5 }}
                            >
                                {children}
                            </Typography>
                        ),
                        h3: ({ children }) => (
                            <Typography
                                variant="h6"
                                component="h3"
                                sx={{ fontWeight: 600, mt: 3, mb: 1 }}
                            >
                                {children}
                            </Typography>
                        ),
                        p: ({ children }) => (
                            <Typography
                                variant="body1"
                                sx={{ mb: 1.5, lineHeight: 1.7 }}
                            >
                                {children}
                            </Typography>
                        ),
                        strong: ({ children }) => (
                            <Box component="strong" sx={{ fontWeight: 700 }}>
                                {children}
                            </Box>
                        ),
                        em: ({ children }) => (
                            <Box component="em" sx={{ fontStyle: "italic" }}>
                                {children}
                            </Box>
                        ),
                        a: ({ href, children }) => (
                            <Link
                                href={href}
                                target={
                                    href?.startsWith("http")
                                        ? "_blank"
                                        : undefined
                                }
                                rel={
                                    href?.startsWith("http")
                                        ? "noopener noreferrer"
                                        : undefined
                                }
                            >
                                {children}
                            </Link>
                        ),
                        ul: ({ children }) => (
                            <Box
                                component="ul"
                                sx={{
                                    pl: 3,
                                    mb: 2,
                                    "& li": { mb: 0.75 },
                                }}
                            >
                                {children}
                            </Box>
                        ),
                        ol: ({ children }) => (
                            <Box
                                component="ol"
                                sx={{
                                    pl: 3,
                                    mb: 2,
                                    "& li": { mb: 0.75 },
                                }}
                            >
                                {children}
                            </Box>
                        ),
                        li: ({ children }) => (
                            <Typography
                                component="li"
                                variant="body1"
                                sx={{ lineHeight: 1.7 }}
                            >
                                {children}
                            </Typography>
                        ),
                        hr: () => <Divider sx={{ my: 3 }} />,
                        table: ({ children }) => (
                            <TableContainer
                                component={Paper}
                                variant="outlined"
                                sx={{ mb: 2, overflowX: "auto" }}
                            >
                                <Table size="small">{children}</Table>
                            </TableContainer>
                        ),
                        thead: ({ children }) => (
                            <TableHead>{children}</TableHead>
                        ),
                        tbody: ({ children }) => (
                            <TableBody>{children}</TableBody>
                        ),
                        tr: ({ children }) => <TableRow>{children}</TableRow>,
                        th: ({ children }) => (
                            <TableCell
                                component="th"
                                sx={{ fontWeight: 700, verticalAlign: "top" }}
                            >
                                {children}
                            </TableCell>
                        ),
                        td: ({ children }) => (
                            <TableCell sx={{ verticalAlign: "top" }}>
                                {children}
                            </TableCell>
                        ),
                    }}
                >
                    {privacyPolicy}
                </ReactMarkdown>
            </Box>
        </Container>
    );
}
