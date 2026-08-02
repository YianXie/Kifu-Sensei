import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryRouter, Route, Routes } from "react-router";

import { afterEach, describe, expect, it, vi } from "vitest";

import Navbar from "@/components/layout/Navbar";
import { useAuth } from "@/contexts/AuthContext";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const originalMatchMedia = window.matchMedia;

function mockMobileViewport() {
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

function renderNavbar(isAuthenticated: boolean) {
    mockMobileViewport();
    mockedUseAuth.mockReturnValue({
        isAuthenticated,
    } as unknown as ReturnType<typeof useAuth>);

    return render(
        <MemoryRouter initialEntries={["/"]}>
            <Navbar />
            <Routes>
                <Route path="/" element={<p>home page</p>} />
                <Route path="/settings" element={<p>settings page</p>} />
                <Route path="/logout" element={<p>logout page</p>} />
                <Route path="/login" element={<p>login page</p>} />
            </Routes>
        </MemoryRouter>
    );
}

describe("Navbar mobile drawer", () => {
    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    it("navigates when a row's icon is clicked, not just its label text", async () => {
        renderNavbar(true);

        await userEvent.click(
            screen.getByRole("button", { name: "Open navigation menu" })
        );

        const settingsLink = screen.getByRole("link", { name: /settings/i });
        const icon = settingsLink.querySelector("svg");
        expect(icon).not.toBeNull();

        await userEvent.click(icon as SVGElement);

        expect(await screen.findByText("settings page")).toBeInTheDocument();
    });

    it("navigates the logout row from its icon for an authenticated user", async () => {
        renderNavbar(true);

        await userEvent.click(
            screen.getByRole("button", { name: "Open navigation menu" })
        );

        const logoutLink = screen.getByRole("link", { name: /logout/i });
        const icon = logoutLink.querySelector("svg");

        await userEvent.click(icon as SVGElement);

        expect(await screen.findByText("logout page")).toBeInTheDocument();
    });

    it("navigates the login row from its icon for a signed-out user", async () => {
        renderNavbar(false);

        await userEvent.click(
            screen.getByRole("button", { name: "Open navigation menu" })
        );

        const loginLink = screen.getByRole("link", { name: /login/i });
        const icon = loginLink.querySelector("svg");

        await userEvent.click(icon as SVGElement);

        expect(await screen.findByText("login page")).toBeInTheDocument();
    });
});
