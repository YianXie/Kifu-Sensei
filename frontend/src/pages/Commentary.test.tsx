import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryRouter } from "react-router";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentaryResponse } from "@shared/types";

import { useAuth } from "@/contexts/AuthContext";
import Commentary from "@/pages/Commentary";

vi.mock("@/api", () => ({
    // The page submits a job and then polls it, so both verbs are part of the
    // surface under test now.
    default: { post: vi.fn(), get: vi.fn() },
}));

vi.mock("react-toastify", () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const api = (await import("@/api")).default as unknown as {
    post: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
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
    /** A poll answer for a run that has not finished. */
    function polling(progress = { done: 0, total: 0 }) {
        return {
            data: {
                job_id: "job-1",
                status: "running",
                progress,
                result: null,
                error: null,
            },
        };
    }

    it("submits a job rather than holding one request open", async () => {
        api.post.mockResolvedValue({ data: { job_id: "job-1" } });
        api.get.mockResolvedValue(polling());
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        await screen.findByText("Finding the key moments…");
        expect(api.post).toHaveBeenCalledWith(
            expect.stringContaining("/api/commentary/jobs/"),
            expect.objectContaining({ sgf_file_name: "game.sgf" })
        );
    });

    it("reports the backend's real progress once it has a total", async () => {
        api.post.mockResolvedValue({ data: { job_id: "job-1" } });
        api.get.mockResolvedValue(polling({ done: 7, total: 20 }));
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        expect(
            await screen.findByText("Move 7 of 20 key moments")
        ).toBeInTheDocument();
        const bar = await screen.findByRole("progressbar", {
            name: "Review progress",
        });
        expect(bar).toHaveAttribute("aria-valuenow", "35");
    });

    it("stops watching without claiming the run was cancelled", async () => {
        api.post.mockResolvedValue({ data: { job_id: "job-1" } });
        api.get.mockResolvedValue(polling());
        renderPage();
        await uploadFile();
        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        await userEvent.click(
            await screen.findByRole("button", { name: "Stop watching" })
        );

        expect(
            await screen.findByRole("button", { name: "Generate" })
        ).toBeInTheDocument();
        // Nothing can stop the run server-side, so the copy must not imply it did.
        expect(toast.info).toHaveBeenCalledWith(
            expect.stringContaining("keeps running")
        );
    });

    // Both surfaces share one active-run slot, so a 409 here usually means the
    // extension is already reviewing something. Attaching beats reporting a
    // conflict the user can do nothing about.
    it("attaches to a run already going on the account", async () => {
        api.post.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    code: "job_already_running",
                    detail: "Already running.",
                    job_id: "other-surface-job",
                },
            },
        });
        api.get.mockResolvedValue(polling({ done: 3, total: 20 }));
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        expect(
            await screen.findByText("Picking up your review…")
        ).toBeInTheDocument();
        expect(api.get).toHaveBeenCalledWith(
            expect.stringContaining("other-surface-job")
        );
        expect(toast.error).not.toHaveBeenCalled();
    });

    it("renders the result the job finished with", async () => {
        api.post.mockResolvedValue({ data: { job_id: "job-1" } });
        api.get.mockResolvedValue({
            data: {
                job_id: "job-1",
                status: "succeeded",
                progress: { done: 1, total: 1 },
                result: RESULT,
                error: null,
            },
        });
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        expect(
            await screen.findByRole("button", {
                name: "Download annotated SGF file",
            })
        ).toBeInTheDocument();
    });

    it("explains a submission that never reached the backend", async () => {
        api.post.mockRejectedValue(new Error("Network Error"));
        renderPage();
        await uploadFile();

        await userEvent.click(screen.getByRole("button", { name: "Generate" }));

        await screen.findByRole("button", { name: "Generate" });
        expect(toast.error).toHaveBeenCalled();
    });
});

describe("viewing an already-generated result without an API key", () => {
    it("renders the result instead of the API-key gate", () => {
        renderWithResult(false);

        expect(
            screen.getByRole("button", { name: "Download annotated SGF file" })
        ).toBeInTheDocument();
        expect(
            screen.queryByText("AI provider required")
        ).not.toBeInTheDocument();
    });

    it("still gates a fresh upload behind the API-key screen", () => {
        mockAuth(false);
        renderPage();

        expect(screen.getByText("AI provider required")).toBeInTheDocument();
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
        // Suffixed, not verbatim: handing the browser the uploaded name meant the
        // annotated record downloaded on top of the file the user had just picked.
        expect(anchorClicks[0].download).toBe("history-game_annotated.sgf");
    });

    it("saves the record as an SGF rather than as plain text", async () => {
        renderWithResult(true);

        const blobs: Blob[] = [];
        const realCreateObjectURL = URL.createObjectURL;
        vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
            blobs.push(blob as Blob);
            return "blob:stub";
        });
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const realCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation(
            (tag: string, options?: ElementCreationOptions) => {
                const el = realCreateElement(tag, options);
                if (tag === "a") (el as HTMLAnchorElement).click = vi.fn();
                return el;
            }
        );

        await userEvent.click(
            screen.getByRole("button", { name: "Download annotated SGF file" })
        );

        expect(blobs[0].type).toBe("application/x-go-sgf");
        URL.createObjectURL = realCreateObjectURL;
    });
});
