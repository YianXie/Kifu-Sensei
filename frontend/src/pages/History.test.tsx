import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryRouter } from "react-router";

import { beforeEach, describe, expect, it, vi } from "vitest";

import History from "@/pages/History";
import type { CommentaryHistoryItem } from "@/types/commentary";

vi.mock("@/api", () => ({
    default: { get: vi.fn() },
}));

vi.mock("react-toastify", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const api = (await import("@/api")).default as unknown as {
    get: ReturnType<typeof vi.fn>;
};

function item(id: number): CommentaryHistoryItem {
    return {
        id,
        board_size: 19,
        sgf_file_name: `game${id}.sgf`,
        language: "english",
        model: "claude-sonnet-5",
        created_at: "2026-01-01T00:00:00Z",
        moves: [],
        initial_stones: [],
        comment_count: 2,
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <History />
        </MemoryRouter>
    );
}

beforeEach(() => {
    api.get.mockReset();
});

describe("loading, empty, and error states", () => {
    it("shows a loading state before the first fetch resolves", () => {
        api.get.mockReturnValue(new Promise(() => {}));
        renderPage();
        expect(screen.getByText(/loading your history/i)).toBeInTheDocument();
    });

    it("shows an empty state with a call to action when there are no sessions", async () => {
        api.get.mockResolvedValue({ data: { commentaries: [], total: 0 } });
        renderPage();

        expect(await screen.findByText(/no sessions yet/i)).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /generate commentary/i })
        ).toBeInTheDocument();
    });

    it("shows a distinct error state, not the empty state, when the fetch fails", async () => {
        api.get.mockRejectedValue(new Error("network error"));
        renderPage();

        expect(
            await screen.findByText(/could not load your history/i)
        ).toBeInTheDocument();
        expect(screen.queryByText(/no sessions yet/i)).not.toBeInTheDocument();
    });

    it("retries the fetch when Retry is clicked", async () => {
        api.get.mockRejectedValueOnce(new Error("network error"));
        renderPage();
        await screen.findByText(/could not load your history/i);

        api.get.mockResolvedValueOnce({
            data: { commentaries: [item(1)], total: 1 },
        });
        await userEvent.click(screen.getByRole("button", { name: /retry/i }));

        expect(await screen.findByText("game1.sgf")).toBeInTheDocument();
    });
});

describe("listing sessions", () => {
    it("renders every session from the first page", async () => {
        api.get.mockResolvedValue({
            data: { commentaries: [item(1), item(2)], total: 2 },
        });
        renderPage();

        expect(await screen.findByText("game1.sgf")).toBeInTheDocument();
        expect(screen.getByText("game2.sgf")).toBeInTheDocument();
        expect(screen.getByText("2 sessions")).toBeInTheDocument();
    });

    it("does not show Load more when everything already fits on one page", async () => {
        api.get.mockResolvedValue({
            data: { commentaries: [item(1)], total: 1 },
        });
        renderPage();

        await screen.findByText("game1.sgf");
        expect(
            screen.queryByRole("button", { name: /load more/i })
        ).not.toBeInTheDocument();
    });

    it("fetches and appends the next page when Load more is clicked", async () => {
        api.get.mockResolvedValueOnce({
            data: { commentaries: [item(1)], total: 2 },
        });
        renderPage();
        await screen.findByText("game1.sgf");

        api.get.mockResolvedValueOnce({
            data: { commentaries: [item(2)], total: 2 },
        });
        await userEvent.click(
            screen.getByRole("button", { name: /load more/i })
        );

        expect(await screen.findByText("game2.sgf")).toBeInTheDocument();
        // Both sessions stay on screen — appended, not replaced.
        expect(screen.getByText("game1.sgf")).toBeInTheDocument();
        expect(api.get).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.objectContaining({ params: { limit: 20, offset: 1 } })
        );
        await waitFor(() =>
            expect(
                screen.queryByRole("button", { name: /load more/i })
            ).not.toBeInTheDocument()
        );
    });
});
