import {
    Box,
    Divider,
    FormControl,
    FormHelperText,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Typography,
} from "@mui/material";

export default function CommentaryConfig({
    model,
    setModel,
    numComments,
    setNumComments,
    maxToken,
    setMaxToken,
    customInstruction,
    setCustomInstruction,
}: {
    model: "claude-opus-4-8" | "claude-sonnet-4-6" | "claude-haiku-4-5";
    setModel: (
        value: "claude-opus-4-8" | "claude-sonnet-4-6" | "claude-haiku-4-5"
    ) => void;
    numComments: number;
    setNumComments: (value: number) => void;
    maxToken: number;
    setMaxToken: (value: number) => void;
    customInstruction: string;
    setCustomInstruction: (value: string) => void;
}) {
    return (
        <Paper
            elevation={0}
            sx={{
                width: "100%",
                mt: 2,
                px: { xs: 2, sm: 3 },
                py: { xs: 2.5, sm: 3 },
                borderRadius: 3,
                border: "1px solid",
                borderColor: "divider",
            }}
        >
            <Stack spacing={3}>
                <Box>
                    <Typography variant="h6" fontWeight={700}>
                        Commentary Configuration
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Tune how the AI generates analysis for your game.
                    </Typography>
                </Box>

                <Divider />

                <FormControl size="small" fullWidth>
                    <InputLabel id="claude-model-select-label">
                        Claude Model
                    </InputLabel>
                    <Select
                        labelId="claude-model-select-label"
                        value={model}
                        label="Claude Model"
                        onChange={(event) => {
                            setModel(
                                event.target.value as
                                    | "claude-opus-4-8"
                                    | "claude-sonnet-4-6"
                                    | "claude-haiku-4-5"
                            );
                        }}
                    >
                        <MenuItem value="claude-opus-4-8">
                            Claude Opus 4.8
                        </MenuItem>
                        <MenuItem value="claude-sonnet-4-6">
                            Claude Sonnet 4.6
                        </MenuItem>
                        <MenuItem value="claude-haiku-4-5">
                            Claude Haiku 4.5
                        </MenuItem>
                    </Select>
                    <FormHelperText>
                        Select a model based on quality and speed preference.
                    </FormHelperText>
                </FormControl>

                <Box
                    sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                        gap: 1.5,
                    }}
                >
                    <TextField
                        fullWidth
                        size="small"
                        variant="outlined"
                        label="Number of Comments"
                        type="number"
                        value={numComments}
                        slotProps={{
                            htmlInput: {
                                min: 1,
                                max: 100,
                            },
                        }}
                        onChange={(event) => {
                            setNumComments(parseInt(event.target.value));
                        }}
                        helperText="Recommended: 15-30"
                    />
                    <TextField
                        fullWidth
                        size="small"
                        variant="outlined"
                        label="Max Token"
                        type="number"
                        value={maxToken}
                        slotProps={{
                            htmlInput: {
                                min: 256,
                                max: 8192,
                            },
                        }}
                        onChange={(event) => {
                            setMaxToken(parseInt(event.target.value));
                        }}
                        helperText="Recommended: 512-2048"
                    />
                </Box>

                <TextField
                    fullWidth
                    size="small"
                    variant="outlined"
                    label="Custom Instruction"
                    placeholder="e.g. Focus on strategic turning points and explain alternatives briefly."
                    value={customInstruction}
                    slotProps={{
                        htmlInput: {
                            maxLength: 1000,
                        },
                    }}
                    multiline
                    minRows={4}
                    onChange={(event) => {
                        setCustomInstruction(event.target.value);
                    }}
                    helperText="Optional: Add your preferred writing style or analysis focus."
                />
            </Stack>
        </Paper>
    );
}
