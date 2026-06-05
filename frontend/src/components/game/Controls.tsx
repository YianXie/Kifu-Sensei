import type { ReactNode } from "react";

import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import FastForwardIcon from "@mui/icons-material/FastForward";
import FastRewindIcon from "@mui/icons-material/FastRewind";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

import placeStoneSoundInstance from "@/assets/sounds/placeStoneSoundInstance";
import { FAST_FORWARD_AMOUNT } from "@/constants/game/controls";

function ControlMoveButton({
    icon,
    label,
    amount,
    onMoveChange,
    disabled,
}: {
    icon: ReactNode;
    label: string;
    amount: number;
    onMoveChange: (amount: number) => void;
    disabled: boolean;
}) {
    return (
        <span>
            <IconButton
                disabled={disabled}
                aria-label={label}
                onClick={() => {
                    placeStoneSoundInstance.currentTime = 0;
                    void placeStoneSoundInstance.play();
                    onMoveChange(amount);
                }}
            >
                {icon}
            </IconButton>
        </span>
    );
}

export default function Controls({
    maxMove,
    currentMoveIndex,
    onMoveChange,
    onJumpToPreviousComment,
    onJumpToNextComment,
    hasPreviousCommentMove = false,
    hasNextCommentMove = false,
    sx: sxOverride,
}: {
    maxMove: number;
    currentMoveIndex: number;
    onMoveChange: (amount: number) => void;
    onJumpToPreviousComment?: () => void;
    onJumpToNextComment?: () => void;
    hasPreviousCommentMove?: boolean;
    hasNextCommentMove?: boolean;
    sx?: SxProps<Theme>;
}) {
    return (
        <Paper
            sx={[
                {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    containerType: "inline-size",
                    gap: "clamp(1px, 1cqw, 8px)",
                    p: "clamp(3px, 1.5cqw, 8px)",
                    borderRadius: "0 0 12px 12px",
                    flexWrap: "nowrap",
                    overflow: "hidden",
                    "& .MuiIconButton-root": {
                        width: "clamp(20px, 9cqw, 40px)",
                        height: "clamp(20px, 9cqw, 40px)",
                        p: 0,
                    },
                    "& .MuiSvgIcon-root": {
                        fontSize: "clamp(0.875rem, 5cqw, 1.5rem)",
                    },
                },
                ...(Array.isArray(sxOverride)
                    ? sxOverride
                    : sxOverride
                      ? [sxOverride]
                      : []),
            ]}
        >
            <Stack
                direction="row"
                sx={{
                    gap: "clamp(1px, 1cqw, 4px)",
                    ml: "auto",
                    minWidth: 0,
                }}
            >
                <ControlMoveButton
                    amount={-maxMove}
                    icon={<SkipPreviousIcon />}
                    label="Move to the beginning"
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex <= 0}
                />
                <ControlMoveButton
                    amount={-FAST_FORWARD_AMOUNT}
                    icon={<FastRewindIcon />}
                    label={`Rewind ${FAST_FORWARD_AMOUNT} moves`}
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex <= 0}
                />
                <ControlMoveButton
                    amount={-1}
                    icon={<ArrowBackIosIcon />}
                    label="Move backward 1 move"
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex <= 0}
                />
                <Tooltip
                    title="Jump to previous move with commentary"
                    placement="top"
                    arrow
                >
                    <span>
                        <ControlMoveButton
                            amount={0}
                            icon={
                                <ArrowBackIosIcon
                                    sx={{
                                        color: hasPreviousCommentMove
                                            ? "warning.main"
                                            : "default",
                                    }}
                                />
                            }
                            label="Jump to previous move with commentary"
                            onMoveChange={() => onJumpToPreviousComment?.()}
                            disabled={!hasPreviousCommentMove}
                        />
                    </span>
                </Tooltip>
            </Stack>

            <Typography
                variant="body2"
                sx={{
                    minWidth: "clamp(20px, 8cqw, 40px)",
                    textAlign: "center",
                    fontWeight: 500,
                    flexShrink: 0,
                }}
            >
                {currentMoveIndex}
            </Typography>

            <Stack
                direction="row"
                sx={{
                    gap: "clamp(1px, 1cqw, 4px)",
                    mr: "auto",
                    minWidth: 0,
                }}
            >
                <Tooltip
                    title="Jump to next move with commentary"
                    placement="top"
                    arrow
                >
                    <span>
                        <ControlMoveButton
                            amount={0}
                            icon={
                                <ArrowForwardIosIcon
                                    fontSize="small"
                                    sx={{
                                        color: hasNextCommentMove
                                            ? "warning.main"
                                            : "default",
                                    }}
                                />
                            }
                            label="Jump to next move with commentary"
                            onMoveChange={() => onJumpToNextComment?.()}
                            disabled={!hasNextCommentMove}
                        />
                    </span>
                </Tooltip>
                <ControlMoveButton
                    amount={1}
                    icon={<ArrowForwardIosIcon fontSize="small" />}
                    label="Move forward 1 move"
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex >= maxMove}
                />

                <ControlMoveButton
                    amount={FAST_FORWARD_AMOUNT}
                    icon={<FastForwardIcon />}
                    label={`Fast forward ${FAST_FORWARD_AMOUNT} moves`}
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex >= maxMove}
                />
                <ControlMoveButton
                    amount={maxMove}
                    icon={<SkipNextIcon />}
                    label="Move to the end"
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex >= maxMove}
                />
            </Stack>
        </Paper>
    );
}
