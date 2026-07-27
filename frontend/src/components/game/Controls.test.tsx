import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { describe, expect, it, vi } from "vitest";

import Controls from "@/components/game/Controls";
import { FAST_FORWARD_AMOUNT } from "@/constants/game/controls";

function setup(overrides: Partial<Parameters<typeof Controls>[0]> = {}) {
    const onMoveChange = vi.fn();
    const onJumpToPreviousComment = vi.fn();
    const onJumpToNextComment = vi.fn();
    render(
        <Controls
            maxMove={100}
            currentMoveIndex={50}
            onMoveChange={onMoveChange}
            onJumpToPreviousComment={onJumpToPreviousComment}
            onJumpToNextComment={onJumpToNextComment}
            {...overrides}
        />
    );
    return { onMoveChange, onJumpToPreviousComment, onJumpToNextComment };
}

describe("Controls", () => {
    it("shows the current move number", () => {
        setup({ currentMoveIndex: 42 });
        expect(screen.getByText("42")).toBeInTheDocument();
    });

    it.each([
        ["Move backward 1 move", -1],
        ["Move forward 1 move", 1],
        [`Rewind ${FAST_FORWARD_AMOUNT} moves`, -FAST_FORWARD_AMOUNT],
        [`Fast forward ${FAST_FORWARD_AMOUNT} moves`, FAST_FORWARD_AMOUNT],
        ["Move to the beginning", -100],
        ["Move to the end", 100],
    ])("%s requests a change of %i", async (label, amount) => {
        const { onMoveChange } = setup();

        await userEvent.click(screen.getByRole("button", { name: label }));

        expect(onMoveChange).toHaveBeenCalledWith(amount);
    });

    it("disables every backward control at the start of the game", () => {
        setup({ currentMoveIndex: 0 });

        for (const label of [
            "Move to the beginning",
            `Rewind ${FAST_FORWARD_AMOUNT} moves`,
            "Move backward 1 move",
        ]) {
            expect(screen.getByRole("button", { name: label })).toBeDisabled();
        }
        expect(
            screen.getByRole("button", { name: "Move forward 1 move" })
        ).toBeEnabled();
    });

    it("disables every forward control at the end of the game", () => {
        setup({ currentMoveIndex: 100, maxMove: 100 });

        for (const label of [
            "Move to the end",
            `Fast forward ${FAST_FORWARD_AMOUNT} moves`,
            "Move forward 1 move",
        ]) {
            expect(screen.getByRole("button", { name: label })).toBeDisabled();
        }
        expect(
            screen.getByRole("button", { name: "Move backward 1 move" })
        ).toBeEnabled();
    });

    it("disables the comment jumps when there is nowhere to jump", () => {
        setup({ hasPreviousCommentMove: false, hasNextCommentMove: false });

        expect(
            screen.getByRole("button", {
                name: "Jump to previous move with commentary",
            })
        ).toBeDisabled();
        expect(
            screen.getByRole("button", {
                name: "Jump to next move with commentary",
            })
        ).toBeDisabled();
    });

    it("jumps to the neighbouring commented moves", async () => {
        const { onJumpToPreviousComment, onJumpToNextComment, onMoveChange } =
            setup({ hasPreviousCommentMove: true, hasNextCommentMove: true });

        await userEvent.click(
            screen.getByRole("button", {
                name: "Jump to previous move with commentary",
            })
        );
        await userEvent.click(
            screen.getByRole("button", {
                name: "Jump to next move with commentary",
            })
        );

        expect(onJumpToPreviousComment).toHaveBeenCalledTimes(1);
        expect(onJumpToNextComment).toHaveBeenCalledTimes(1);
        // The jump buttons must not also nudge the move index.
        expect(onMoveChange).not.toHaveBeenCalled();
    });

    it("plays the stone sound when a move control is used", async () => {
        const play = vi.spyOn(window.HTMLMediaElement.prototype, "play");
        setup();

        await userEvent.click(
            screen.getByRole("button", { name: "Move forward 1 move" })
        );

        expect(play).toHaveBeenCalled();
    });
});
