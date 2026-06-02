import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import FastForwardIcon from "@mui/icons-material/FastForward";
import FastRewindIcon from "@mui/icons-material/FastRewind";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

import ControlMoveButton from "./ControlMoveButton";

const FAST_FORWARD_AMOUNT = 5;

const Controls = ({
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
}) => {
    return (
        <Paper
            sx={[
                {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    p: 1,
                    borderRadius: "0 0 12px 12px",
                    flexWrap: "wrap",
                },
                ...(Array.isArray(sxOverride)
                    ? sxOverride
                    : sxOverride
                      ? [sxOverride]
                      : []),
            ]}
        >
            <Stack direction="row" spacing={0.5} sx={{ ml: "auto" }}>
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
                    minWidth: 40,
                    textAlign: "center",
                    fontWeight: 500,
                }}
            >
                {currentMoveIndex}
            </Typography>

            <Stack direction="row" spacing={0.5} sx={{ mr: "auto" }}>
                <ControlMoveButton
                    amount={1}
                    icon={<ArrowForwardIosIcon fontSize="small" />}
                    label="Move forward 1 move"
                    onMoveChange={onMoveChange}
                    disabled={currentMoveIndex >= maxMove}
                />
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
};

export default Controls;
