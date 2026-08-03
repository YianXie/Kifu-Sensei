import placeStoneSoundInstance from "@/assets/sounds/placeStoneSoundInstance";
import { IconButton, Tooltip } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { FAST_FORWARD_AMOUNT } from "@/constants/game/controls";

function ControlMoveButton({
    icon,
    label,
    amount,
    onMoveChange,
    disabled,
    soundEnabled,
    tone = "neutral",
}: {
    icon: IconName;
    label: string;
    amount: number;
    onMoveChange: (amount: number) => void;
    disabled: boolean;
    soundEnabled: boolean;
    tone?: "neutral" | "accent";
}) {
    return (
        <IconButton
            icon={icon}
            label={label}
            tone={tone}
            disabled={disabled}
            onClick={() => {
                if (soundEnabled) {
                    placeStoneSoundInstance.currentTime = 0;
                    void placeStoneSoundInstance.play();
                }
                onMoveChange(amount);
            }}
        />
    );
}

/**
 * The dock beneath the board: first / rewind 5 / back / jump-to-comment, the
 * move counter, then the mirrored forward set.
 */
export default function Controls({
    maxMove,
    currentMoveIndex,
    onMoveChange,
    onJumpToPreviousComment,
    onJumpToNextComment,
    hasPreviousCommentMove = false,
    hasNextCommentMove = false,
    soundEnabled = true,
}: {
    maxMove: number;
    currentMoveIndex: number;
    onMoveChange: (amount: number) => void;
    onJumpToPreviousComment?: () => void;
    onJumpToNextComment?: () => void;
    hasPreviousCommentMove?: boolean;
    hasNextCommentMove?: boolean;
    /** The user's "play a stone sound when stepping through moves" preference. */
    soundEnabled?: boolean;
}) {
    const atStart = currentMoveIndex <= 0;
    const atEnd = currentMoveIndex >= maxMove;

    return (
        <div className="ks-controls">
            <div className="ks-controls__group ks-controls__group--start">
                <ControlMoveButton
                    icon="skip_previous"
                    label="Move to the beginning"
                    amount={-maxMove}
                    onMoveChange={onMoveChange}
                    disabled={atStart}
                    soundEnabled={soundEnabled}
                />
                <ControlMoveButton
                    icon="fast_rewind"
                    label={`Rewind ${FAST_FORWARD_AMOUNT} moves`}
                    amount={-FAST_FORWARD_AMOUNT}
                    onMoveChange={onMoveChange}
                    disabled={atStart}
                    soundEnabled={soundEnabled}
                />
                <ControlMoveButton
                    icon="arrow_back_ios"
                    label="Move backward 1 move"
                    amount={-1}
                    onMoveChange={onMoveChange}
                    disabled={atStart}
                    soundEnabled={soundEnabled}
                />
                <Tooltip title="Jump to previous move with commentary">
                    <ControlMoveButton
                        icon="chevron_left"
                        label="Jump to previous move with commentary"
                        amount={0}
                        tone={hasPreviousCommentMove ? "accent" : "neutral"}
                        onMoveChange={() => onJumpToPreviousComment?.()}
                        disabled={!hasPreviousCommentMove}
                        soundEnabled={soundEnabled}
                    />
                </Tooltip>
            </div>

            <span className="ks-controls__counter">
                {currentMoveIndex}/{maxMove}
            </span>

            <div className="ks-controls__group ks-controls__group--end">
                <Tooltip title="Jump to next move with commentary">
                    <ControlMoveButton
                        icon="chevron_right"
                        label="Jump to next move with commentary"
                        amount={0}
                        tone={hasNextCommentMove ? "accent" : "neutral"}
                        onMoveChange={() => onJumpToNextComment?.()}
                        disabled={!hasNextCommentMove}
                        soundEnabled={soundEnabled}
                    />
                </Tooltip>
                <ControlMoveButton
                    icon="arrow_forward_ios"
                    label="Move forward 1 move"
                    amount={1}
                    onMoveChange={onMoveChange}
                    disabled={atEnd}
                    soundEnabled={soundEnabled}
                />
                <ControlMoveButton
                    icon="fast_forward"
                    label={`Fast forward ${FAST_FORWARD_AMOUNT} moves`}
                    amount={FAST_FORWARD_AMOUNT}
                    onMoveChange={onMoveChange}
                    disabled={atEnd}
                    soundEnabled={soundEnabled}
                />
                <ControlMoveButton
                    icon="skip_next"
                    label="Move to the end"
                    amount={maxMove}
                    onMoveChange={onMoveChange}
                    disabled={atEnd}
                    soundEnabled={soundEnabled}
                />
            </div>
        </div>
    );
}
