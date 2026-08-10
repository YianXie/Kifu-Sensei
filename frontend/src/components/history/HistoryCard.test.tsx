import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentaryHistoryItem, CommentaryResponse } from "@shared/types";

import HistoryCard from "@/components/history/HistoryCard";
import { ENDPOINTS } from "@/constants/global/endpoints";

vi.mock("@/api", () => ({
    default: { get: vi.fn(), delete: vi.fn() },
}));

vi.mock("react-toastify", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const api = (await import("@/api")).default as unknown as {
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};
const { toast } = (await import("react-toastify")) as unknown as {
    toast: { error: ReturnType<typeof vi.fn> };
};

const SUMMARY: CommentaryHistoryItem = {
    id: 42,
    board_size: 19,
    sgf_file_name: "game.sgf",
    language: "english",
    model: "claude-sonnet-5",
    created_at: "2026-01-01T00:00:00Z",
    moves: [["B", [3, 3]]],
    initial_stones: [],
    comment_count: 3,
};

const DETAIL: CommentaryResponse = {
    board_size: 19,
    sgf_file_name: "game.sgf",
    language: "english",
    model: "claude-sonnet-5",
    moves: [["B", [3, 3]]],
    initial_stones: [],
    comments: [{ turn: 1, comment: "Hi", winrate_delta: null, color: null }],
    annotated_sgf_content: "(;FF[4]C[Hi])",
};

// jsdom has no createObjectURL/revokeObjectURL implementation.
beforeEach(() => {
    api.get.mockReset();
    api.delete.mockReset();
    toast.error.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
});

describe("opening a session", () => {
    it("fetches the full record and hands it to onOpen", async () => {
        api.get.mockResolvedValue({ data: DETAIL });
        const onOpen = vi.fn();
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={onOpen}
                onDelete={vi.fn()}
            />
        );

        await userEvent.click(screen.getByRole("button", { name: /open/i }));

        expect(api.get).toHaveBeenCalledWith(
            ENDPOINTS.userCommentaryHistoryDetail(42)
        );
        expect(onOpen).toHaveBeenCalledWith(DETAIL);
    });

    it("shows an error toast and does not call onOpen if the fetch fails", async () => {
        api.get.mockRejectedValue(new Error("network error"));
        const onOpen = vi.fn();
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={onOpen}
                onDelete={vi.fn()}
            />
        );

        await userEvent.click(screen.getByRole("button", { name: /open/i }));

        expect(onOpen).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
    });
});

describe("downloading a session", () => {
    it("fetches the full record before building the download", async () => {
        api.get.mockResolvedValue({ data: DETAIL });
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={vi.fn()}
                onDelete={vi.fn()}
            />
        );

        await userEvent.click(
            screen.getByRole("button", { name: /download/i })
        );

        expect(api.get).toHaveBeenCalledWith(
            ENDPOINTS.userCommentaryHistoryDetail(42)
        );
        expect(URL.createObjectURL).toHaveBeenCalled();
    });
});

describe("deleting a session", () => {
    it("asks for confirmation before deleting anything", async () => {
        const onDelete = vi.fn();
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={vi.fn()}
                onDelete={onDelete}
            />
        );

        await userEvent.click(
            screen.getByRole("button", { name: /delete session/i })
        );

        expect(
            screen.getByRole("dialog", { name: /delete this session\?/i })
        ).toBeInTheDocument();
        expect(api.delete).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
    });

    it("does not delete when the dialog is cancelled", async () => {
        const onDelete = vi.fn();
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={vi.fn()}
                onDelete={onDelete}
            />
        );

        await userEvent.click(
            screen.getByRole("button", { name: /delete session/i })
        );
        await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

        expect(api.delete).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
    });

    it("deletes the record and notifies the parent once confirmed", async () => {
        api.delete.mockResolvedValue({ status: 204 });
        const onDelete = vi.fn();
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={vi.fn()}
                onDelete={onDelete}
            />
        );

        await userEvent.click(
            screen.getByRole("button", { name: /delete session/i })
        );
        await userEvent.click(
            screen.getByRole("button", { name: /^delete$/i })
        );

        expect(api.delete).toHaveBeenCalledWith(
            ENDPOINTS.userCommentaryHistoryDetail(42)
        );
        expect(onDelete).toHaveBeenCalledWith(42);
    });

    it("keeps the card and shows the error if the delete fails", async () => {
        api.delete.mockRejectedValue(new Error("network error"));
        const onDelete = vi.fn();
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={vi.fn()}
                onDelete={onDelete}
            />
        );

        await userEvent.click(
            screen.getByRole("button", { name: /delete session/i })
        );
        await userEvent.click(
            screen.getByRole("button", { name: /^delete$/i })
        );

        expect(onDelete).not.toHaveBeenCalled();
        expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
});

describe("rendering the summary", () => {
    it("shows the comment count from the summary without fetching", () => {
        render(
            <HistoryCard
                commentary={SUMMARY}
                onOpen={vi.fn()}
                onDelete={vi.fn()}
            />
        );
        expect(screen.getByText(/3 comments/)).toBeInTheDocument();
        expect(api.get).not.toHaveBeenCalled();
    });
});
