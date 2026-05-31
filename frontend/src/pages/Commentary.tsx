import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import {
    Box,
    Button,
    CircularProgress,
    Container,
    Typography,
} from "@mui/material";

import api from "@/api";
import { ENDPOINTS } from "@/constants";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

function isSgfFile(file: File) {
    return file.name.toLowerCase().endsWith(".sgf");
}

export default function Commentary() {
    usePageTitle("Commentary");

    const navigate = useNavigate();
    const { userSettings } = useAuth();
    const hasClaudeApiKey = userSettings?.has_claude_api_key ?? false;

    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [comments, setComments] = useState<string[] | null>(null);

    function handleFile(uploadedFile: File | undefined) {
        if (!uploadedFile || !isSgfFile(uploadedFile)) {
            toast.error("Only .sgf file is supported!");
            return;
        }
        setFile(uploadedFile);
    }

    function handleRemoveFile() {
        setFile(null);
    }

    function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
        handleFile(event.target.files?.[0]);
        event.target.value = "";
    }

    function handleDragOver(event: React.DragEvent) {
        event.preventDefault();
        setIsDragOver(true);
    }

    function handleDragLeave(event: React.DragEvent) {
        event.preventDefault();
        setError(false);
        setIsDragOver(false);
    }

    function handleDrop(event: React.DragEvent) {
        event.preventDefault();
        setIsDragOver(false);
        handleFile(event.dataTransfer.files[0]);
    }

    async function handleGenerate() {
        try {
            setIsLoading(true);
            const sgfContent = await file?.text();
            const { data } = await api.post(ENDPOINTS.commentary, {
                sgf_content: sgfContent,
            });
            setComments(data);
            console.log(data);
        } catch (error) {
            console.error("Error generating commentary:", error);
            toast.error("Error generating commentary");
        } finally {
            setIsLoading(false);
        }
    }

    if (isLoading) {
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
                    }}
                >
                    <CircularProgress size={48} />
                    <Typography variant="body1" color="text.secondary">
                        Generating commentary…
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        This may take a minute depending on game length.
                    </Typography>
                </Box>
            </Container>
        );
    }

    if (!hasClaudeApiKey) {
        return (
            <Container maxWidth="sm">
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        textAlign: "center",
                        gap: 2,
                        minHeight: "70vh",
                    }}
                >
                    <KeyOutlinedIcon color="primary" sx={{ fontSize: 56 }} />
                    <Typography variant="h5" fontWeight={700}>
                        Claude API key required
                    </Typography>
                    <Typography color="text.secondary" maxWidth={420}>
                        You skipped setting up your Claude API key. Add it to
                        start generating commentary on your games.
                    </Typography>
                    <Button
                        variant="contained"
                        size="large"
                        startIcon={<KeyOutlinedIcon />}
                        onClick={() => navigate("/setup-api-key")}
                    >
                        Set up API key
                    </Button>
                </Box>
            </Container>
        );
    }

    return (
        <Container maxWidth="md">
            {comments ? (
                comments.map((comment, index) => (
                    <Typography key={index}>{comment}</Typography>
                ))
            ) : (
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 3,
                        minHeight: "70vh",
                    }}
                >
                    <Box
                        component="label"
                        htmlFor="sgf-upload"
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 1,
                            width: 240,
                            height: 240,
                            borderRadius: 3,
                            border: "2px dashed",
                            borderColor: isDragOver
                                ? "primary.main"
                                : error
                                  ? "primary.error"
                                  : "divider",
                            bgcolor: isDragOver
                                ? "action.hover"
                                : "transparent",
                            cursor: "pointer",
                            transition:
                                "border-color 0.2s ease, background-color 0.2s ease",
                            "&:hover": {
                                bgcolor: "action.hover",
                            },
                        }}
                    >
                        <input
                            id="sgf-upload"
                            type="file"
                            accept=".sgf"
                            hidden
                            onChange={handleInputChange}
                        />
                        <CloudUploadOutlinedIcon
                            color={isDragOver ? "primary" : "action"}
                            sx={{ fontSize: 48 }}
                        />
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            textAlign="center"
                            px={2}
                        >
                            {isDragOver
                                ? "Drop .sgf file here"
                                : file
                                  ? file.name
                                  : "Click or drag to upload .sgf file"}
                        </Typography>
                    </Box>

                    <Button
                        variant="contained"
                        onClick={handleGenerate}
                        disabled={!file}
                    >
                        GENERATE
                    </Button>

                    {file && (
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={handleRemoveFile}
                        >
                            REMOVE FILE
                        </Button>
                    )}
                </Box>
            )}
        </Container>
    );
}
