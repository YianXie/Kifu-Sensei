import ReactMarkdown from "react-markdown";

import remarkGfm from "remark-gfm";

import privacyPolicy from "@/content/privacy-policy.md?raw";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Privacy() {
    usePageTitle("Privacy Policy");

    return (
        <div className="ks-page ks-container ks-container--md">
            <span className="ks-eyebrow">Legal</span>
            <article
                className="ks-prose"
                style={{ marginTop: "var(--space-8)" }}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        a: ({ href, children }) => (
                            <a
                                href={href}
                                target={
                                    href?.startsWith("http")
                                        ? "_blank"
                                        : undefined
                                }
                                rel={
                                    href?.startsWith("http")
                                        ? "noopener noreferrer"
                                        : undefined
                                }
                            >
                                {children}
                            </a>
                        ),
                        // Wide tables scroll inside their own box rather than
                        // forcing the page to scroll sideways.
                        table: ({ children }) => (
                            <div className="ks-prose__table">
                                <table>{children}</table>
                            </div>
                        ),
                    }}
                >
                    {privacyPolicy}
                </ReactMarkdown>
            </article>
        </div>
    );
}
