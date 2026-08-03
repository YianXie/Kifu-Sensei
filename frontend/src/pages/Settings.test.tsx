import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ENDPOINTS } from "@/constants/global/endpoints";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Settings from "@/pages/Settings";

vi.mock("@/api", () => ({
    default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock("react-toastify", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const api = (await import("@/api")).default as unknown as {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
};

/** A JWT with a readable payload — only `jwtDecode` reads it, never verified here. */
function fakeJwt(payload: Record<string, unknown>): string {
    const encode = (value: unknown) =>
        btoa(JSON.stringify(value)).replace(/=+$/, "");
    return `${encode({ alg: "HS256" })}.${encode(payload)}.signature`;
}

const VALID_TOKEN = fakeJwt({
    user_id: 7,
    email: "player@example.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
});

const SETTINGS = {
    preferences: {
        commentary_config: {
            model: "claude-sonnet-5",
            language: "english",
            num_comments: 20,
            max_token: 1024,
            custom_instruction: "",
        },
    },
    has_claude_api_key: true,
};

async function renderSettingsOnCommentaryTab() {
    localStorage.setItem("access_token", VALID_TOKEN);
    api.get.mockResolvedValue({ data: SETTINGS });

    render(
        <AuthProvider>
            <ThemeProvider>
                <Settings />
            </ThemeProvider>
        </AuthProvider>
    );

    await waitFor(() =>
        expect(
            screen.getByRole("tab", { name: "Default commentary config" })
        ).toBeInTheDocument()
    );
    await userEvent.click(
        screen.getByRole("tab", { name: "Default commentary config" })
    );
}

beforeEach(() => {
    localStorage.clear();
    api.get.mockReset();
    api.put.mockReset();
});

describe("saving the default commentary config", () => {
    it("includes the selected language in the saved payload", async () => {
        api.put.mockResolvedValue({
            data: { ...SETTINGS, preferences: { commentary_config: {} } },
        });
        await renderSettingsOnCommentaryTab();

        await userEvent.selectOptions(
            screen.getByRole("combobox", { name: "Commentary language" }),
            "japanese"
        );

        await userEvent.click(
            screen.getByRole("button", { name: "Save defaults" })
        );

        await waitFor(() => expect(api.put).toHaveBeenCalled());
        expect(api.put).toHaveBeenCalledWith(ENDPOINTS.userSettings, {
            preferences: {
                commentary_config: expect.objectContaining({
                    language: "japanese",
                }),
            },
        });
    });

    it("sends every field the commentary page reads back", async () => {
        api.put.mockResolvedValue({
            data: { ...SETTINGS, preferences: { commentary_config: {} } },
        });
        await renderSettingsOnCommentaryTab();

        await userEvent.click(
            screen.getByRole("button", { name: "Save defaults" })
        );

        await waitFor(() => expect(api.put).toHaveBeenCalled());
        const [, body] = api.put.mock.calls[0] as [
            string,
            { preferences: { commentary_config: object } },
        ];
        expect(Object.keys(body.preferences.commentary_config).sort()).toEqual(
            [
                "custom_instruction",
                "language",
                "max_token",
                "model",
                "num_comments",
            ].sort()
        );
    });
});
