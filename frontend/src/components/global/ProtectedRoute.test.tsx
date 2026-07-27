import { render, screen } from "@testing-library/react";

import { MemoryRouter, Route, Routes } from "react-router";

import { describe, expect, it, vi } from "vitest";

import ProtectedRoute from "@/components/global/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

function renderAt(
    path: string,
    state: { isAuthenticated: boolean; isLoading: boolean },
    customRedirect?: string
) {
    mockedUseAuth.mockReturnValue(
        state as unknown as ReturnType<typeof useAuth>
    );
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route
                    element={<ProtectedRoute customRedirect={customRedirect} />}
                >
                    <Route path="/private" element={<p>secret</p>} />
                </Route>
                <Route path="/login" element={<p>login page</p>} />
                <Route path="/elsewhere" element={<p>elsewhere</p>} />
            </Routes>
        </MemoryRouter>
    );
}

describe("ProtectedRoute", () => {
    it("renders the child route for an authenticated user", () => {
        renderAt("/private", { isAuthenticated: true, isLoading: false });
        expect(screen.getByText("secret")).toBeInTheDocument();
    });

    it("redirects an unauthenticated user to /login", () => {
        renderAt("/private", { isAuthenticated: false, isLoading: false });
        expect(screen.getByText("login page")).toBeInTheDocument();
        expect(screen.queryByText("secret")).not.toBeInTheDocument();
    });

    it("honours a custom redirect target", () => {
        renderAt(
            "/private",
            { isAuthenticated: false, isLoading: false },
            "/elsewhere"
        );
        expect(screen.getByText("elsewhere")).toBeInTheDocument();
    });

    it("renders nothing while auth is still resolving", () => {
        // Redirecting during hydration would bounce a signed-in user to the
        // login page on every hard refresh.
        renderAt("/private", { isAuthenticated: false, isLoading: true });
        expect(screen.queryByText("secret")).not.toBeInTheDocument();
        expect(screen.queryByText("login page")).not.toBeInTheDocument();
    });
});
