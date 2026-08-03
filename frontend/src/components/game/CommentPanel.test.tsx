import { render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import CommentPanel from "@/components/game/CommentPanel";

function setup(overrides: Partial<Parameters<typeof CommentPanel>[0]> = {}) {
    render(
        <CommentPanel
            moves={[]}
            currentMoveIndex={0}
            currentComment=""
            {...overrides}
        />
    );
}

describe("CommentPanel accessibility", () => {
    it("announces the current comment as a live region", () => {
        setup({ currentComment: "A strong opening move." });

        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("A strong opening move.");
    });

    it("announces the empty-comment fallback text too", () => {
        setup({ currentMoveIndex: 3, currentComment: "" });

        expect(screen.getByRole("status")).toHaveTextContent(
            "No commentary was generated for this move."
        );
    });
});
