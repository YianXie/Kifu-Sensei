import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";

import api from "@/api";
import HistoryCard from "@/components/history/HistoryCard";
import { Button, Card, EmptyState, Spinner } from "@/components/ui";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { usePageTitle } from "@/hooks/usePageTitle";
import { UserCommentaryHistory } from "@/types/auth";
import { CommentaryHistoryItem, CommentaryResponse } from "@/types/commentary";
import { getErrorMessage } from "@/utils/errorFormatting";

const PAGE_SIZE = 20;

type Status = "loading" | "loaded" | "error";

export default function History() {
    usePageTitle("History");

    const navigate = useNavigate();
    const [commentaries, setCommentaries] = useState<CommentaryHistoryItem[]>(
        []
    );
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState<Status>("loading");
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const loadPage = useCallback(async (offset: number) => {
        const { data } = await api.get<UserCommentaryHistory>(
            ENDPOINTS.userCommentaryHistory,
            { params: { limit: PAGE_SIZE, offset } }
        );
        return data;
    }, []);

    useEffect(() => {
        let cancelled = false;
        setStatus("loading");
        loadPage(0)
            .then((data) => {
                if (cancelled) return;
                setCommentaries(data.commentaries);
                setTotal(data.total);
                setStatus("loaded");
            })
            .catch((error) => {
                if (cancelled) return;
                console.error("Error fetching user commentary history:", error);
                setStatus("error");
            });
        return () => {
            cancelled = true;
        };
    }, [loadPage]);

    async function handleRetry() {
        setStatus("loading");
        try {
            const data = await loadPage(0);
            setCommentaries(data.commentaries);
            setTotal(data.total);
            setStatus("loaded");
        } catch (error) {
            console.error("Error fetching user commentary history:", error);
            setStatus("error");
        }
    }

    async function handleLoadMore() {
        setIsLoadingMore(true);
        try {
            const data = await loadPage(commentaries.length);
            setCommentaries((prev) => [...prev, ...data.commentaries]);
            setTotal(data.total);
        } catch (error) {
            toast.error(
                getErrorMessage(error, "Could not load more sessions.")
            );
        } finally {
            setIsLoadingMore(false);
        }
    }

    const handleOpen = (commentary: CommentaryResponse) => {
        navigate("/commentary", { state: { commentary } });
    };

    const handleDelete = (id: number) => {
        setCommentaries((prev) => prev.filter((c) => c.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
    };

    return (
        <div className="ks-container ks-container--lg ks-page">
            <div className="ks-page__head">
                <div>
                    <span className="ks-eyebrow">Saved reviews</span>
                    <h1 className="ks-page__title">Commentary history</h1>
                    <p className="ks-page__lead">
                        {status === "loaded"
                            ? `${total} session${total === 1 ? "" : "s"}`
                            : " "}
                    </p>
                </div>
            </div>

            {status === "loading" && (
                <div
                    className="ks-center"
                    style={{ padding: "var(--space-17) 0" }}
                >
                    <Spinner size={40} label="Loading your history…" />
                </div>
            )}

            {status === "error" && (
                <Card>
                    <EmptyState
                        icon="error"
                        title="Could not load your history"
                        body="Something went wrong while fetching your saved sessions."
                        actions={
                            <Button variant="outline" onClick={handleRetry}>
                                Retry
                            </Button>
                        }
                    />
                </Card>
            )}

            {status === "loaded" && commentaries.length === 0 && (
                <Card>
                    <EmptyState
                        icon="history"
                        title="No sessions yet"
                        body="Generate commentary on a game and it will show up here."
                        actions={
                            <Button onClick={() => navigate("/commentary")}>
                                Generate commentary
                            </Button>
                        }
                    />
                </Card>
            )}

            {status === "loaded" && commentaries.length > 0 && (
                <div className="ks-history">
                    {commentaries.map((c) => (
                        <HistoryCard
                            key={c.id}
                            commentary={c}
                            onOpen={handleOpen}
                            onDelete={handleDelete}
                        />
                    ))}
                    {commentaries.length < total && (
                        <div
                            style={{
                                alignSelf: "center",
                                marginTop: "var(--space-2)",
                            }}
                        >
                            <Button
                                variant="outline"
                                onClick={handleLoadMore}
                                disabled={isLoadingMore}
                            >
                                {isLoadingMore ? "Loading…" : "Load more"}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
