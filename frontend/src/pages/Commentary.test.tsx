import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryRouter } from "react-router";

import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentaryResponse } from "@shared/types";

import { useAuth } from "@/contexts/AuthContext";
import Commentary from "@/pages/Commentary";

vi.mock("@/api", () => ({
    default: { post: vi.fn() },
}));

vi.mock("react-toastify", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const api = (await import("@/api")).default as unknown as {
    post: ReturnType<typeof vi.fn>;
};
const { toast } = (await import("react-toastify")) as unknown as {
    toast: {
        success: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
        info: ReturnType<typeof vi.fn>;
    };
};
const mockedUseAuth = vi.mocked(useAuth);

function mockAuth(hasClaudeApiKey: boolean) {
    mockedUseAuth.mockReturnValue({
        userSettings: { has_claude_api_key: hasClaudeApiKey, preferences: {} },
    } as unknown as ReturnType<typeof useAuth>);
}

function renderPage() {
    return render(
        <MemoryRouter>
            <Commentary />
        </MemoryRouter>
    );
}

const RESULT: CommentaryResponse = {
    board_size: 19,
    sgf_file_name: "history-game.sgf",
    language: "english",
    moves: [["B", [3, 3]]],
    initial_stones: [],
    comments: [{ turn: 1, comment: "Hi", winrate_delta: null, color: null }],
    annotated_sgf_content: "(;FF[4]C[Hi])",
};

function renderWithResult(hasClaudeApiKey: boolean) {
    mockAuth(hasClaudeApiKey);
    return render(
        <MemoryRouter
            initialEntries={[
                { pathname: "/commentary", state: { commentary: RESULT } },
            ]}
        >
            <Commentary />
        </MemoryRouter>
    );
}

async function uploadFile() {
    const file = new File(["(;FF[4]GM[1]SZ[19];B[dd])"], "game.sgf", {
        type: "application/octet-stream",
    });
    const input = document.getElementById("sgf-upload") as HTMLInputElement;
    await userEvent.upload(input, file);
}

beforeEach(() => {
    api.post.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    toast.info.mockReset();
    mockAuth(true);
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
});

describe("generating commentary", () => {
    it("shows a Cancel button while a request is in flight", async () => {
        api.post.mockReturnValue(new Promise(() => {})); // never resolves
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        expect(
            await screen.findByRole("button", { name: "Cancel" })
        ).toBeInTheDocument();
    });

    it("aborts the request and returns to the upload screen when cancelled", async () => {
        let capturedSignal: AbortSignal | undefined;
        api.post.mockImplementation(
            (
                _url: string,
                _body: unknown,
                config?: { signal?: AbortSignal }
            ) => {
                capturedSignal = config?.signal;
                return new Promise((_resolve, reject) => {
                    config?.signal?.addEventListener("abort", () => {
                        reject(new axios.CanceledError("canceled"));
                    });
                });
            }
        );
        renderPage();
        await uploadFile();
        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        await userEvent.click(
            await screen.findByRole("button", { name: "Cancel" })
        );

        expect(capturedSignal?.aborted).toBe(true);
        expect(
            await screen.findByRole("button", { name: "Generate" })
        ).toBeInTheDocument();
    });

    it("points the user at History when an unclassified error occurs", async () => {
        api.post.mockRejectedValue(new Error("Network Error"));
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        await screen.findByRole("button", { name: "Generate" });
        expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining("History")
        );
    });
});

describe("viewing an already-generated result without an API key", () => {
    it("renders the result instead of the API-key gate", () => {
        renderWithResult(false);

        expect(
            screen.getByRole("button", { name: "Download annotated SGF file" })
        ).toBeInTheDocument();
        expect(
            screen.queryByText("Claude API key required")
        ).not.toBeInTheDocument();
    });

    it("still gates a fresh upload behind the API-key screen", () => {
        mockAuth(false);
        renderPage();

        expect(screen.getByText("Claude API key required")).toBeInTheDocument();
    });
});

describe("downloading the annotated SGF", () => {
    it("names the download after the backend's sgf_file_name, not the local file", async () => {
        // Viewing a History result: nothing was ever uploaded in this session, so
        // `file` is null and only `result.sgf_file_name` has the real name.
        renderWithResult(true);

        const anchorClicks: HTMLAnchorElement[] = [];
        const realCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(
            (tag: string, options?: ElementCreationOptions) => {
                const el = realCreateElement(tag, options);
                if (tag === "a") {
                    anchorClicks.push(el as HTMLAnchorElement);
                    (el as HTMLAnchorElement).click = vi.fn();
                }
                return el;
            }
        );

        await userEvent.click(
            screen.getByRole("button", { name: "Download annotated SGF file" })
        );

        expect(anchorClicks).toHaveLength(1);
        expect(anchorClicks[0].download).toBe("history-game.sgf");
    });
});
