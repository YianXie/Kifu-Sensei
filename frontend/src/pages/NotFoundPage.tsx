import { useNavigate } from "react-router";

import { Button, Icon } from "@/components/ui";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function NotFound() {
    usePageTitle("Page not found");
    const navigate = useNavigate();

    return (
        <div
            className="ks-auth"
            style={{ alignItems: "center", textAlign: "center" }}
        >
            {/* Decorative mini-board suggesting "nothing landed here". */}
            <div className="ks-404__board" aria-hidden="true">
                <div className="ks-404__marker">
                    <Icon name="grid_off" size="sm" />
                </div>
            </div>

            <span className="ks-eyebrow">Error 404</span>
            <h1 className="ks-auth__title">Page not found</h1>
            <p className="ks-auth__lead">
                That URL isn&apos;t part of Kifu-Sensei — like a move outside
                the board lines. Double-check the address or head back home.
            </p>

            <div style={{ display: "flex", gap: "var(--space-8)" }}>
                <Button size="lg" onClick={() => navigate("/")}>
                    Back to home
                </Button>
                <Button
                    size="lg"
                    variant="outline"
                    onClick={() => navigate(-1)}
                >
                    Go back
                </Button>
            </div>
        </div>
    );
}
