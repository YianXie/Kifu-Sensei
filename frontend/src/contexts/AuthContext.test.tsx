import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ENDPOINTS } from "@/constants/global/endpoints";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// The context is the only consumer of the axios instance under test here; the
// instance's own behaviour is covered in `api.test.ts`.
vi.mock("@/api", () => ({
    default: { get: vi.fn(), post: vi.fn() },
}));

const api = (await import("@/api")).default as unknown as {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
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

const EXPIRED_TOKEN = fakeJwt({
    user_id: 7,
    email: "player@example.com",
    exp: Math.floor(Date.now() / 1000) - 3600,
    iat: Math.floor(Date.now() / 1000) - 7200,
});

const SETTINGS = { preferences: { theme: "dark" }, has_claude_api_key: true };

function Probe() {
    const { user, userSettings, isAuthenticated, isLoading, login, logout } =
        useAuth();
    return (
        <div>
            <span data-testid="loading">{String(isLoading)}</span>
            <span data-testid="authenticated">{String(isAuthenticated)}</span>
            <span data-testid="email">{user?.email ?? "-"}</span>
            <span data-testid="has-key">
                {String(userSettings?.has_claude_api_key ?? "-")}
            </span>
            <button onClick={() => void login("a@b.com", "password")}>
                log in
            </button>
            <button onClick={logout}>log out</button>
        </div>
    );
}

function renderProbe() {
    return render(
        <AuthProvider>
            <Probe />
        </AuthProvider>
    );
}

beforeEach(() => {
    localStorage.clear();
    api.get.mockReset();
    api.post.mockReset();
});

describe("hydration on mount", () => {
    it("finishes unauthenticated when there is no stored token", async () => {
        renderProbe();

        await waitFor(() =>
            expect(screen.getByTestId("loading")).toHaveTextContent("false")
        );
        expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
        expect(api.get).not.toHaveBeenCalled();
    });

    it("restores the user and settings from a valid stored token", async () => {
        localStorage.setItem("access_token", VALID_TOKEN);
        api.get.mockResolvedValue({ data: SETTINGS });

        renderProbe();

        await waitFor(() =>
            expect(screen.getByTestId("email")).toHaveTextContent(
                "player@example.com"
            )
        );
        expect(api.get).toHaveBeenCalledWith(ENDPOINTS.userSettings);
        expect(screen.getByTestId("has-key")).toHaveTextContent("true");
        expect(screen.getByTestId("authenticated")).toHaveTextContent("true");
    });

    it("logs out rather than trusting an expired token", async () => {
        localStorage.setItem("access_token", EXPIRED_TOKEN);
        localStorage.setItem("refresh_token", "stored-refresh");

        renderProbe();

        await waitFor(() =>
            expect(screen.getByTestId("authenticated")).toHaveTextContent(
                "false"
            )
        );
        expect(localStorage.getItem("access_token")).toBeNull();
        expect(api.get).not.toHaveBeenCalled();
    });

    it("logs out when the stored token is not a JWT at all", async () => {
        localStorage.setItem("access_token", "not-a-jwt");

        renderProbe();

        await waitFor(() =>
            expect(screen.getByTestId("loading")).toHaveTextContent("false")
        );
        expect(localStorage.getItem("access_token")).toBeNull();
    });

    it("logs out when the settings request fails", async () => {
        localStorage.setItem("access_token", VALID_TOKEN);
        api.get.mockRejectedValue(new Error("401"));

        renderProbe();

        await waitFor(() =>
            expect(screen.getByTestId("authenticated")).toHaveTextContent(
                "false"
            )
        );
        expect(localStorage.getItem("access_token")).toBeNull();
    });
});

describe("login", () => {
    it("stores both tokens and loads settings", async () => {
        api.post.mockResolvedValue({
            data: {
                access: "new-access",
                refresh: "new-refresh",
                user: { id: 7, email: "player@example.com" },
            },
        });
        api.get.mockResolvedValue({ data: SETTINGS });
        renderProbe();
        await waitFor(() =>
            expect(screen.getByTestId("loading")).toHaveTextContent("false")
        );

        await userEvent.click(screen.getByRole("button", { name: "log in" }));

        await waitFor(() =>
            expect(screen.getByTestId("authenticated")).toHaveTextContent(
                "true"
            )
        );
        expect(api.post).toHaveBeenCalledWith(ENDPOINTS.tokenObtain, {
            email: "a@b.com",
            password: "password",
        });
        expect(localStorage.getItem("access_token")).toBe("new-access");
        expect(localStorage.getItem("refresh_token")).toBe("new-refresh");
        expect(screen.getByTestId("has-key")).toHaveTextContent("true");
    });
});

describe("logout", () => {
    it("clears the session and the extension handoff", async () => {
        // The website's `extension_auth` entry must go too: leaving it behind
        // lets the extension silently pick the session back up.
        localStorage.setItem("access_token", VALID_TOKEN);
        localStorage.setItem("refresh_token", "stored-refresh");
        localStorage.setItem(
            "extension_auth",
            JSON.stringify({ accessToken: "a", refreshToken: "b" })
        );
        api.get.mockResolvedValue({ data: SETTINGS });
        renderProbe();
        await waitFor(() =>
            expect(screen.getByTestId("authenticated")).toHaveTextContent(
                "true"
            )
        );

        await userEvent.click(screen.getByRole("button", { name: "log out" }));

        expect(localStorage.getItem("access_token")).toBeNull();
        expect(localStorage.getItem("refresh_token")).toBeNull();
        expect(localStorage.getItem("extension_auth")).toBeNull();
        expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
        expect(screen.getByTestId("email")).toHaveTextContent("-");
    });
});

describe("useAuth", () => {
    it("throws when used outside the provider", () => {
        // React logs the error boundary trace; silence it for this one case.
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        expect(() => render(<Probe />)).toThrow(
            "useAuth must be used inside <AuthProvider>"
        );

        consoleError.mockRestore();
    });
});
