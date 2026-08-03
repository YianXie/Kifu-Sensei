import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryRouter, Route, Routes } from "react-router";

import { afterEach, describe, expect, it, vi } from "vitest";

import Navbar from "@/components/layout/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const originalMatchMedia = window.matchMedia;

/** `matches` drives both the mobile breakpoint and the dark-scheme query, which
 *  is harmless here — only the breakpoint changes what the navbar renders. */
function mockViewport(matches: boolean) {
    window.matchMedia = ((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

function renderNavbar(isAuthenticated: boolean, { mobile = true } = {}) {
    mockViewport(mobile);
    mockedUseAuth.mockReturnValue({
        isAuthenticated,
    } as unknown as ReturnType<typeof useAuth>);

    return render(
        <MemoryRouter initialEntries={["/"]}>
            <ThemeProvider>
                <Navbar />
                <Routes>
                    <Route path="/" element={<p>home page</p>} />
                    <Route path="/settings" element={<p>settings page</p>} />
                    <Route path="/privacy" element={<p>privacy page</p>} />
                    <Route path="/logout" element={<p>logout page</p>} />
                    <Route path="/login" element={<p>login page</p>} />
                </Routes>
            </ThemeProvider>
        </MemoryRouter>
    );
}

afterEach(() => {
    window.matchMedia = originalMatchMedia;
});

describe("Navbar mobile drawer", () => {
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

    it("keeps Privacy reachable on mobile, for signed-out visitors too", async () => {
        renderNavbar(false);

        await userEvent.click(
            screen.getByRole("button", { name: "Open navigation menu" })
        );

        await userEvent.click(screen.getByRole("link", { name: /privacy/i }));

        expect(await screen.findByText("privacy page")).toBeInTheDocument();
    });
});

describe("Navbar account menu", () => {
    async function openAccountMenu() {
        renderNavbar(true, { mobile: false });
        await userEvent.click(screen.getByRole("button", { name: "Account" }));
    }

    // Regression: the outside-click handler used to close the menu on mousedown
    // before the click reached the item, so nothing ever navigated.
    it("navigates to Settings", async () => {
        await openAccountMenu();

        await userEvent.click(
            screen.getByRole("menuitem", { name: /settings/i })
        );

        expect(await screen.findByText("settings page")).toBeInTheDocument();
    });

    it("navigates to Privacy, which is no longer in the bar", async () => {
        await openAccountMenu();

        expect(
            screen.queryByRole("link", { name: "Privacy" })
        ).not.toBeInTheDocument();

        await userEvent.click(
            screen.getByRole("menuitem", { name: /privacy/i })
        );

        expect(await screen.findByText("privacy page")).toBeInTheDocument();
    });

    it("navigates to Logout", async () => {
        await openAccountMenu();

        await userEvent.click(
            screen.getByRole("menuitem", { name: /logout/i })
        );

        expect(await screen.findByText("logout page")).toBeInTheDocument();
    });

    it("leaves History out of the menu — it is already a link in the bar", async () => {
        await openAccountMenu();

        expect(
            screen.queryByRole("menuitem", { name: /history/i })
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "History" })
        ).toBeInTheDocument();
    });

    it("closes when a click lands outside it", async () => {
        await openAccountMenu();
        expect(screen.getByRole("menu")).toBeInTheDocument();

        await userEvent.click(document.body);

        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
});
