import {
    CUSTOM_INSTRUCTION_MAX,
    MAX_TOKEN_MAX,
    MAX_TOKEN_MIN,
    NUM_COMMENTS_MAX,
    NUM_COMMENTS_MIN,
} from "@shared/commentary";
import type { ClaudeModel, CommentaryLanguage } from "@shared/types";

import {
    Divider,
    Field,
    Input,
    Panel,
    Select,
    Textarea,
} from "@/components/ui";

const LANGUAGE_OPTIONS: { value: CommentaryLanguage; label: string }[] = [
    { value: "english", label: "English" },
    { value: "chinese (simplified)", label: "Chinese (simplified)" },
    { value: "japanese", label: "Japanese" },
    { value: "korean", label: "Korean" },
];

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
    heading = "Commentary configuration",
    lead = "Tune how the AI generates analysis for your game.",
    /** Keeps the two instances of this form from sharing element ids. */
    idPrefix = "cfg",
    /**
     * Moves in the game being reviewed, when there is one.
     *
     * There is no point asking for more comments than there are moves — the
     * pipeline picks the N worst moves, so anything past the move count is
     * silently ignored. The extension's config screen has always clamped to this;
     * the website offered 100 comments on a 40-move game.
     */
    moveCount,
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
    heading?: string;
    lead?: string;
    idPrefix?: string;
    moveCount?: number;
}) {
    const maxComments =
        moveCount !== undefined && moveCount > 0
            ? Math.min(NUM_COMMENTS_MAX, moveCount)
            : NUM_COMMENTS_MAX;

    return (
        <Panel heading={heading} lead={lead}>
            <Divider spacing="20px" />
            <div className="ks-form-grid">
                <Field
                    label="AI model"
                    htmlFor={`${idPrefix}-model`}
                    hint="Enter the model ID supported by your configured provider."
                >
                    <Input
                        id={`${idPrefix}-model`}
                        value={model}
                        placeholder="claude-sonnet-5 or gpt-4o"
                        onChange={(event) => setModel(event.target.value)}
                    />
                </Field>

                <Field
                    label="Commentary language"
                    htmlFor={`${idPrefix}-language`}
                    hint="Select a language based on your preference."
                >
                    <Select
                        id={`${idPrefix}-language`}
                        value={language}
                        options={LANGUAGE_OPTIONS}
                        onChange={(event) =>
                            setLanguage(
                                event.target.value as CommentaryLanguage
                            )
                        }
                    />
                </Field>

                <Field
                    label="Number of comments"
                    htmlFor={`${idPrefix}-num-comments`}
                    hint={
                        moveCount !== undefined && moveCount > 0
                            ? `${NUM_COMMENTS_MIN}–${maxComments} (this game has ${moveCount} moves). Recommended: 15-30`
                            : "Recommended: 15-30"
                    }
                >
                    <Input
                        id={`${idPrefix}-num-comments`}
                        type="number"
                        mono
                        min={NUM_COMMENTS_MIN}
                        max={maxComments}
                        value={numComments}
                        onChange={(event) => {
                            const next = parseBoundedInt(
                                event.target.value,
                                NUM_COMMENTS_MIN,
                                maxComments
                            );
                            if (next !== undefined) {
                                setNumComments(next);
                            }
                        }}
                    />
                </Field>

                <Field
                    label="Max token"
                    htmlFor={`${idPrefix}-max-token`}
                    hint={`${MAX_TOKEN_MIN}–${MAX_TOKEN_MAX} per comment. Recommended: 512-2048`}
                >
                    <Input
                        id={`${idPrefix}-max-token`}
                        type="number"
                        mono
                        min={MAX_TOKEN_MIN}
                        max={MAX_TOKEN_MAX}
                        value={maxToken}
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
                    />
                </Field>

                <div className="ks-form-grid__full">
                    <Field
                        label="Custom instruction"
                        htmlFor={`${idPrefix}-instruction`}
                        hint="Optional: add your preferred writing style or analysis focus."
                    >
                        <Textarea
                            id={`${idPrefix}-instruction`}
                            rows={3}
                            maxLength={CUSTOM_INSTRUCTION_MAX}
                            placeholder="e.g. Focus on strategic turning points and explain alternatives briefly."
                            value={customInstruction}
                            onChange={(event) =>
                                setCustomInstruction(event.target.value)
                            }
                        />
                        <p className="ks-field__hint" aria-live="polite">
                            {customInstruction.length}/{CUSTOM_INSTRUCTION_MAX}
                        </p>
                    </Field>
                </div>
            </div>
        </Panel>
    );
}
