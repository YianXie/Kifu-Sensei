import { render, screen } from "@testing-library/react";

import { describe, expect, it } from "vitest";

import type { GameMove } from "@shared/types";

import GoBoard from "@/components/game/GoBoard";

function setup(overrides: Partial<Parameters<typeof GoBoard>[0]> = {}) {
    render(
        <GoBoard
            boardSize={19}
            moves={[]}
            comments={{}}
            currentMoveIndex={0}
            onMoveChange={() => {}}
            {...overrides}
        />
    );
}

describe("GoBoard accessibility", () => {
    it("labels the starting position for screen readers", () => {
        setup();

        expect(
            screen.getByRole("img", {
                name: /19x19 Go board, move 0 of 0: starting position/,
            })
        ).toBeInTheDocument();
    });

    it("describes the last move played", () => {
        const moves: GameMove[] = [["B", [3, 3]]];

        setup({ moves, currentMoveIndex: 1 });

        expect(
            screen.getByRole("img", {
                name: /move 1 of 1: Black played D4/,
            })
        ).toBeInTheDocument();
    });

    it("describes a White move using GTP coordinates", () => {
        const moves: GameMove[] = [
            ["B", [3, 3]],
            ["W", [15, 15]],
        ];

        setup({ moves, currentMoveIndex: 2 });

        expect(
            screen.getByRole("img", {
                name: /White played Q16/,
            })
        ).toBeInTheDocument();
    });
});
