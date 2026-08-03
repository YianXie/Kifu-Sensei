import { type ReactNode, useRef } from "react";
import { useNavigate } from "react-router";

import Demo from "@/components/home/Demo";
import { Button, Card, Chip } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";

const FEATURES: { icon: IconName; title: string; body: ReactNode }[] = [
    {
        icon: "auto_awesome",
        title: "Natural language commentary",
        body: (
            <>
                Kifu-Sensei combines KataGo&apos;s numeric analysis with
                human-readable explanations powered by Claude. Instead of raw
                win-rate charts, you get a clear explanation of <em>why</em> a
                move was a mistake and what better alternatives exist.
            </>
        ),
    },
    {
        icon: "tune",
        title: "Fully customizable output",
        body: (
            <>
                Adjust the number of comments, choose your Claude model, set a
                token budget, and add custom instructions — all from the
                commentary page. Tailor the depth and style to match your level
                and budget.
            </>
        ),
    },
    {
        icon: "code",
        title: "Open-source and affordable",
        body: (
            <>
                The frontend and website backend are fully{" "}
                <a
                    href="https://github.com/YianXie/Kifu-Sensei"
                    target="_blank"
                    rel="noreferrer"
                >
                    open-source on GitHub
                </a>
                . With prompt-caching, a 20-move commentary costs well under
                $0.10 — you only pay for your own Claude API key.
            </>
        ),
    },
];

export default function Home() {
    usePageTitle("Home");

    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const featuresRef = useRef<HTMLElement>(null);

    const startCta = () => navigate(isAuthenticated ? "/commentary" : "/login");

    return (
        <div>
            {/* ── Hero ─────────────────────────────────────────────────── */}
            <section className="ks-hero">
                <div className="ks-gridwash" />
                <div className="ks-container ks-hero__inner">
                    <div className="ks-hero__copy">
                        <Chip label="KataGo · Claude · SGF" />
                        <h1 className="ks-hero__title">
                            Understand your mistakes{" "}
                            <em>in words, not just numbers</em>
                        </h1>
                        <p className="ks-hero__lead">
                            Upload an SGF file and receive KataGo-backed
                            analysis paired with Claude-generated commentary for
                            every significant move.
                        </p>
                        <div className="ks-hero__actions">
                            <Button size="lg" endIcon="east" onClick={startCta}>
                                {isAuthenticated
                                    ? "Generate commentary"
                                    : "Get started — it's free"}
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                endIcon="arrow_downward"
                                onClick={() =>
                                    featuresRef.current?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                    })
                                }
                            >
                                See features
                            </Button>
                        </div>
                        <p className="ks-hero__note">
                            A 20-move commentary costs less than $0.10.
                        </p>
                    </div>
                    <div className="ks-hero__demo">
                        <Demo boardCanvasSize={330} />
                    </div>
                </div>
            </section>

            {/* ── Features ─────────────────────────────────────────────── */}
            <section className="ks-section" ref={featuresRef} id="features">
                <div className="ks-container ks-container--lg">
                    <div className="ks-section__head">
                        <span
                            className="ks-eyebrow"
                            style={{ color: "var(--text-accent)" }}
                        >
                            Features
                        </span>
                        <h2 className="ks-section__title">
                            Everything you need to improve
                        </h2>
                        <p className="ks-section__lead">
                            A focused toolkit designed around the one thing most
                            Go analysis tools skip — plain language feedback.
                        </p>
                    </div>
                    <div className="ks-feature-grid">
                        {FEATURES.map(({ icon, title, body }) => (
                            <Card
                                key={title}
                                icon={icon}
                                title={title}
                                interactive
                            >
                                <div className="ks-feature__body">{body}</div>
                            </Card>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── CTA banner ───────────────────────────────────────────── */}
            <section className="ks-cta">
                <div className="ks-cta__inner">
                    <span
                        className="ks-eyebrow"
                        style={{ color: "var(--text-accent)" }}
                    >
                        Ready?
                    </span>
                    <h2 className="ks-section__title">
                        Start analyzing your games today
                    </h2>
                    <p className="ks-section__lead">
                        A 20-move commentary costs less than $0.10. Upload your
                        first SGF and see the difference.
                    </p>
                    <div style={{ marginTop: "var(--space-2)" }}>
                        <Button size="lg" endIcon="east" onClick={startCta}>
                            {isAuthenticated
                                ? "Generate commentary"
                                : "Create a free account"}
                        </Button>
                    </div>
                </div>
            </section>
        </div>
    );
}
