import { useState } from "react";

import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import { Box, Button, Container, Typography } from "@mui/material";

import { usePageTitle } from "@/hooks/usePageTitle";

function isSgfFile(file: File) {
    return file.name.toLowerCase().endsWith(".sgf");
}

export default function Commentary() {
    usePageTitle("Commentary");

    const [file, setFile] = useState<File | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    function handleFile(uploadedFile: File | undefined) {
        if (!uploadedFile || !isSgfFile(uploadedFile)) {
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
        setIsDragOver(false);
    }

    function handleDrop(event: React.DragEvent) {
        event.preventDefault();
        setIsDragOver(false);
        handleFile(event.dataTransfer.files[0]);
    }

    function handleGenerate() {
        console.log("handleGenerate received file:", file);
    }

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
                        borderColor: isDragOver ? "primary.main" : "divider",
                        bgcolor: isDragOver ? "action.hover" : "transparent",
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
        </Container>
    );
}
