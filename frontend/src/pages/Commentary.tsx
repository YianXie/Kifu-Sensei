import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "react-toastify";

import axios from "axios";

import { readCommentaryConfig } from "@shared/commentary";
import {
    type CommentarySeverity,
    colorForTurn,
    coordinateForTurn,
    severityForDelta,
} from "@shared/commentary";
import { downloadAnnotatedSgf } from "@shared/download";
import {
    type ClaudeModel,
    CommentaryLanguage,
    type CommentaryResponse,
} from "@shared/types";
import type { GameMove } from "@shared/types";

import api from "@/api";
import CommentaryConfig from "@/components/commentary/CommentaryConfig";
import SgfDropzone from "@/components/commentary/SgfDropzone";
import CommentaryCard from "@/components/game/CommentaryCard";
import GameViewer from "@/components/game/GameViewer";
import { Button, EmptyState, Icon, Panel, Spinner } from "@/components/ui";
import { ENDPOINTS } from "@/constants/global/endpoints";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getCommentaryError } from "@/utils/errorFormatting";
import { readPlayStoneSound } from "@/utils/preferences";
import { toTitleCase } from "@/utils/string";

/** The stages a review moves through, in order. */
const PIPELINE_STEPS = [
    "Reading the SGF",
    "KataGo first pass — every move scanned",
    "Second pass on the key positions",
    "Claude writing the commentary",
];

const REVIEW_BOARD_SIZE = 460;
const REVIEW_COMMENT_PANEL_HEIGHT = 196;

function isSgfFile(file: File) {
    return file.name.toLowerCase().endsWith(".sgf");
}

export default function Commentary() {
    usePageTitle("Commentary");

    const navigate = useNavigate();
    const location = useLocation();
    const locationState = location.state;
    const { userSettings } = useAuth();
    const hasClaudeApiKey = userSettings?.has_claude_api_key ?? false;
    const defaultConfig = readCommentaryConfig(userSettings?.preferences);

    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<CommentaryResponse | null>(null);
    const [model, setModel] = useState<ClaudeModel>(defaultConfig.model);
    const [language, setLanguage] = useState<CommentaryLanguage>(
        defaultConfig.language
    );
    const [numComments, setNumComments] = useState<number>(
        defaultConfig.num_comments
    );
    const [maxToken, setMaxToken] = useState<number>(defaultConfig.max_token);
    const [customInstruction, setCustomInstruction] = useState<string>(
        defaultConfig.custom_instruction
    );
    const abortControllerRef = useRef<AbortController | null>(null);

    const commentsByTurn = useMemo(() => {
        const map: Record<number, string> = {};
        if (!result) return map;
        for (const item of result.comments) {
            map[item.turn] = item.comment;
        }
        return map;
    }, [result]);

    const severityByTurn = useMemo(() => {
        const map: Record<number, CommentarySeverity> = {};
        if (!result) return map;
        for (const item of result.comments) {
            map[item.turn] = severityForDelta(item.winrate_delta);
        }
        return map;
    }, [result]);

    const moves = (result?.moves ?? []) as GameMove[];
    const initialStones = (result?.initial_stones ?? []) as GameMove[];
    const boardSize = result?.board_size ?? 19;
    const [currentMoveIndex, setCurrentMoveIndex] = useState(0);

    useEffect(() => {
        if (locationState) {
            setResult(locationState.commentary);
        }
    }, [locationState]);

    useEffect(() => {
        if (result) {
            const firstCommentTurn = result.comments[0]?.turn ?? 0;
            setCurrentMoveIndex(firstCommentTurn);
        }
    }, [result]);

    function handleFile(uploadedFile: File | undefined) {
        if (!uploadedFile || !isSgfFile(uploadedFile)) {
            toast.error("Only .sgf file is supported!");
            setError(true);
            return;
        }
        setError(false);
        setFile(uploadedFile);
    }

    function handleDownloadSGF() {
        if (!result) {
            toast.error("No annotated sgf file content found in the frontend!");
            return;
        }
        // `result.sgf_file_name` is what the backend actually annotated — unlike
        // `file`, it's also there when viewing a result loaded from History, where
        // nothing was ever uploaded in this session. The helper suffixes it with
        // `_annotated`; this screen used to hand the browser the uploaded name
        // verbatim, so downloading landed on top of the file just picked.
        downloadAnnotatedSgf(
            result.annotated_sgf_content,
            result.sgf_file_name || file?.name || "commentary"
        );
    }

    async function handleGenerate() {
        const controller = new AbortController();
        abortControllerRef.current = controller;
        try {
            setIsLoading(true);
            const sgfContent = await file?.text();
            const sgfFileName = file?.name;
            const { data } = await api.post<CommentaryResponse>(
                ENDPOINTS.commentary,
                {
                    sgf_file_name: sgfFileName,
                    sgf_content: sgfContent,
                    model,
                    language,
                    num_comments: numComments,
                    max_token: maxToken,
                    custom_instruction: customInstruction,
                },
                { signal: controller.signal }
            );
            setResult(data);
        } catch (err) {
            if (axios.isCancel(err)) {
                // User-initiated: the request may still be running server-side
                // (aborting the client fetch does not stop the pipeline once
                // it's started), so the run could still land in History shortly.
                toast.info(
                    "Cancelled. If the review had already started, it may still finish — check History in a bit."
                );
                return;
            }
            console.error("Error generating commentary:", err);
            const { code, message } = getCommentaryError(err);
            if (code === "no_api_key") {
                toast.error(message);
                // The key was removed after this page loaded, so the guard screen
                // above didn't catch it — send them where they can fix it.
                navigate("/setup-api-key");
            } else if (code === null) {
                // Unclassified — most often a dropped connection rather than a
                // failure the backend reported. The pipeline runs to completion and
                // saves its result server-side independent of whether this response
                // ever arrives, so the run may already be sitting in History even
                // though this request failed.
                toast.error(
                    `${message} If your review had already started, check History — it may already be there.`
                );
            } else {
                toast.error(message);
            }
        } finally {
            abortControllerRef.current = null;
            setIsLoading(false);
        }
    }

    // ── Generating ────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="ks-generating">
                <Spinner size={48} />
                <div style={{ textAlign: "center" }}>
                    <h1 className="ks-page__title ks-page__title--sm">
                        Generating commentary…
                    </h1>
                    <p className="ks-page__lead">
                        This may take a minute depending on game length.
                    </p>
                </div>

                <Panel style={{ width: "100%" }}>
                    <span className="ks-eyebrow">Pipeline</span>
                    <div className="ks-pipeline">
                        {PIPELINE_STEPS.map((step) => (
                            <div className="ks-pipeline__step" key={step}>
                                <Icon name="radio_button_unchecked" size="sm" />
                                <span>{step}</span>
                            </div>
                        ))}
                    </div>
                    <p
                        className="ks-page__meta"
                        style={{ marginTop: "var(--space-9)" }}
                    >
                        Stages run in order; progress is not reported until the
                        review finishes.
                    </p>
                </Panel>

                <Button
                    variant="outline"
                    tone="danger"
                    onClick={() => abortControllerRef.current?.abort()}
                >
                    Cancel
                </Button>
            </div>
        );
    }

    // ── No API key ────────────────────────────────────────────────────────
    if (!hasClaudeApiKey && !result) {
        return (
            <div className="ks-container ks-container--sm ks-page">
                <EmptyState
                    icon="key"
                    title="Claude API key required"
                    body="You skipped setting up your Claude API key. Add it to start generating commentary on your games."
                    actions={
                        <Button
                            size="lg"
                            startIcon="key"
                            onClick={() => navigate("/setup-api-key")}
                        >
                            Set up API key
                        </Button>
                    }
                />
            </div>
        );
    }

    // ── Review ────────────────────────────────────────────────────────────
    if (result) {
        const commentCount = result.comments.length;
        return (
            <div className="ks-container ks-page">
                <div className="ks-page__head">
                    <div>
                        <span className="ks-eyebrow">Review</span>
                        <h1 className="ks-page__title ks-page__title--sm">
                            {result.sgf_file_name}
                        </h1>
                        <p className="ks-page__meta">
                            {boardSize}×{boardSize} · {moves.length} moves ·{" "}
                            {commentCount} comments ·{" "}
                            {toTitleCase(result.language)}
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: "var(--space-8)" }}>
                        <Button
                            startIcon="download"
                            onClick={handleDownloadSGF}
                        >
                            Download annotated SGF file
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setResult(null);
                                setFile(null);
                                setCurrentMoveIndex(0);
                            }}
                        >
                            Upload another game
                        </Button>
                    </div>
                </div>

                <GameViewer
                    boardSize={boardSize}
                    boardCanvasSize={REVIEW_BOARD_SIZE}
                    moves={moves}
                    initialStones={initialStones}
                    comments={commentsByTurn}
                    severityByTurn={severityByTurn}
                    currentMoveIndex={currentMoveIndex}
                    setCurrentMoveIndex={setCurrentMoveIndex}
                    soundEnabled={readPlayStoneSound(userSettings?.preferences)}
                    commentPanelHeight={REVIEW_COMMENT_PANEL_HEIGHT}
                >
                    <span className="ks-eyebrow">
                        All comments · {commentCount}
                    </span>
                    <div className="ks-review__list">
                        {result.comments.map((item) => (
                            <CommentaryCard
                                key={item.turn}
                                move={item.turn}
                                coordinate={coordinateForTurn(moves, item.turn)}
                                color={colorForTurn(
                                    moves,
                                    item.turn,
                                    item.color
                                )}
                                severity={severityForDelta(item.winrate_delta)}
                                winRateDelta={item.winrate_delta}
                                onClick={() => setCurrentMoveIndex(item.turn)}
                            >
                                {item.comment}
                            </CommentaryCard>
                        ))}
                    </div>
                </GameViewer>
            </div>
        );
    }

    // ── Upload ────────────────────────────────────────────────────────────
    return (
        <div className="ks-container ks-page">
            <span className="ks-eyebrow">New review</span>
            <h1 className="ks-page__title">Generate commentary</h1>
            <p
                className="ks-page__lead"
                style={{ marginBottom: "var(--space-13)" }}
            >
                Upload a finished game as an SGF file. KataGo finds the moves
                that cost you the most, then Claude explains them.
            </p>

            <div className="ks-upload">
                <div className="ks-upload__side">
                    <SgfDropzone
                        fileName={file?.name}
                        state={error ? "error" : "idle"}
                        onFile={handleFile}
                    />
                    <Button
                        size="lg"
                        block
                        startIcon="auto_awesome"
                        disabled={!file}
                        onClick={handleGenerate}
                    >
                        Generate
                    </Button>
                    {file && (
                        <Button
                            variant="outline"
                            tone="danger"
                            block
                            onClick={() => setFile(null)}
                        >
                            Remove file
                        </Button>
                    )}
                    <p className="ks-upload__note">
                        Only .sgf is supported. A 20-move commentary costs less
                        than $0.10 against your own key.
                    </p>
                </div>

                <div className="ks-upload__config">
                    <CommentaryConfig
                        model={model}
                        setModel={setModel}
                        language={language}
                        setLanguage={setLanguage}
                        numComments={numComments}
                        setNumComments={setNumComments}
                        maxToken={maxToken}
                        setMaxToken={setMaxToken}
                        customInstruction={customInstruction}
                        setCustomInstruction={setCustomInstruction}
                    />
                </div>
            </div>
        </div>
    );
}
