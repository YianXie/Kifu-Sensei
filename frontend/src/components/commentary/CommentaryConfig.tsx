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

import {
    CUSTOM_INSTRUCTION_MAX,
    MAX_TOKEN_MAX,
    MAX_TOKEN_MIN,
    NUM_COMMENTS_MAX,
    NUM_COMMENTS_MIN,
} from "@/constants/commentary/config";
import type { ClaudeModel, CommentaryLanguage } from "@/types/commentary";

function parseBoundedInt(
    raw: string,
    min: number,
    max: number
): number | undefined {
    if (raw === "") {
        return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return Math.min(max, Math.max(min, parsed));
}

export default function CommentaryConfig({
    model,
    setModel,
    language,
    setLanguage,
    numComments,
    setNumComments,
    maxToken,
    setMaxToken,
    customInstruction,
    setCustomInstruction,
}: {
    model: ClaudeModel;
    setModel: (value: ClaudeModel) => void;
    language: CommentaryLanguage;
    setLanguage: (value: CommentaryLanguage) => void;
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
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        Commentary Configuration
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Tune how the AI generates analysis for your game.
                    </Typography>
                </Box>

                <Divider />

                <Box sx={{ display: "flex", gap: 1.5 }}>
                    <FormControl size="small" fullWidth>
                        <InputLabel id="claude-model-select-label">
                            Claude Model
                        </InputLabel>
                        <Select
                            labelId="claude-model-select-label"
                            value={model}
                            label="Claude Model"
                            onChange={(event) => {
                                setModel(event.target.value);
                            }}
                        >
                            <MenuItem value="claude-fable-5">
                                Claude Fable 5
                            </MenuItem>
                            <MenuItem value="claude-opus-5">
                                Claude Opus 5
                            </MenuItem>
                            <MenuItem value="claude-sonnet-5">
                                Claude Sonnet 5
                            </MenuItem>
                            <MenuItem value="claude-haiku-4-5">
                                Claude Haiku 4.5
                            </MenuItem>
                        </Select>
                        <FormHelperText>
                            Select a model based on quality and speed
                            preference.
                        </FormHelperText>
                    </FormControl>
                    <FormControl size="small" fullWidth>
                        <InputLabel id="commentary-language-select-label">
                            Commentary Language
                        </InputLabel>
                        <Select
                            labelId="commentary-language-select-label"
                            value={language}
                            label="Commentary Language"
                            onChange={(event) => {
                                setLanguage(event.target.value);
                            }}
                        >
                            <MenuItem value="english">English</MenuItem>
                            <MenuItem value="chinese (simplified)">
                                Chinese (simplified)
                            </MenuItem>
                            <MenuItem value="japanese">Japanese</MenuItem>
                            <MenuItem value="korean">Korean</MenuItem>
                        </Select>
                        <FormHelperText>
                            Select a language based on your preference.
                        </FormHelperText>
                    </FormControl>
                </Box>

                <Box
                    sx={{
                        display: "flex",
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
                                min: NUM_COMMENTS_MIN,
                                max: NUM_COMMENTS_MAX,
                            },
                        }}
                        onChange={(event) => {
                            const next = parseBoundedInt(
                                event.target.value,
                                NUM_COMMENTS_MIN,
                                NUM_COMMENTS_MAX
                            );
                            if (next !== undefined) {
                                setNumComments(next);
                            }
                        }}
                        sx={{ flex: 1 }}
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
                                min: MAX_TOKEN_MIN,
                                max: MAX_TOKEN_MAX,
                            },
                        }}
                        onChange={(event) => {
                            const next = parseBoundedInt(
                                event.target.value,
                                MAX_TOKEN_MIN,
                                MAX_TOKEN_MAX
                            );
                            if (next !== undefined) {
                                setMaxToken(next);
                            }
                        }}
                        sx={{ flex: 1 }}
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
                            maxLength: CUSTOM_INSTRUCTION_MAX,
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
