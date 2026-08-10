import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "react-toastify";

import { CLAUDE_MODEL_LABELS, readCommentaryConfig } from "@shared/commentary";
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

import CommentaryConfig from "@/components/commentary/CommentaryConfig";
import SgfDropzone from "@/components/commentary/SgfDropzone";
import CommentaryCard from "@/components/game/CommentaryCard";
import GameViewer from "@/components/game/GameViewer";
import { Button, EmptyState, Panel, Progress, Spinner } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useCommentaryJob } from "@/hooks/useCommentaryJob";
import { usePageTitle } from "@/hooks/usePageTitle";
import { readPlayStoneSound } from "@/utils/preferences";
import { toTitleCase } from "@/utils/string";

const REVIEW_BOARD_SIZE = 460;
const REVIEW_COMMENT_PANEL_HEIGHT = 196;

function isSgfFile(file: File) {
    return file.name.toLowerCase().endsWith(".sgf");
}

/**
 * Roughly how many moves a record contains, for bounding the comment count.
 *
 * Counts move properties rather than parsing: this only has to be close enough to
 * stop the form offering 100 comments on a 40-move game, and the backend clamps to
 * what it actually finds either way. Handicap stones use `AB`/`AW`, not `B`/`W`, so
 * they are correctly excluded.
 */
function countMoves(sgf: string): number {
    return (sgf.match(/;[BW]\[/g) ?? []).length;
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
    const [moveCount, setMoveCount] = useState<number | undefined>(undefined);
    const [error, setError] = useState(false);
    const [result, setResult] = useState<CommentaryResponse | null>(null);

    const {
        isRunning,
        progress,
        isAttached,
        start: startJob,
        stopWatching,
    } = useCommentaryJob({
        onResult: setResult,
        onError: (error) => {
            if (error.code === "no_api_key") {
                toast.error(error.message);
                // The key was removed after this page loaded, so the guard screen
                // below did not catch it — send them where they can fix it.
                navigate("/setup-api-key");
                return;
            }
            // The pipeline saves its result server-side whether or not this client
            // is still watching, so a failure to *watch* is not a failure to run.
            toast.error(
                error.detail
                    ? `${error.message} ${error.detail}`
                    : error.message
            );
        },
    });
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
        // Read once here so the config form can bound itself to the real game,
        // rather than offering more comments than the record has moves.
        void uploadedFile
            .text()
            .then((text) => setMoveCount(countMoves(text)))
            .catch(() => setMoveCount(undefined));
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
        const sgfContent = await file?.text();
        if (file === null || sgfContent === undefined) {
            return;
        }
        await startJob({
            sgf_file_name: file.name,
            sgf_content: sgfContent,
            model,
            language,
            num_comments: numComments,
            max_token: maxToken,
            custom_instruction: customInstruction,
        });
    }

    // ── Generating ────────────────────────────────────────────────────────
    if (isRunning) {
        // Two stages, and only the second has a size: KataGo scans every move and
        // then re-reads the worst ones before the first comment is written, so
        // `total` stays 0 until that is done. Saying so beats a bar that pretends.
        return (
            <div className="ks-generating">
                <Spinner size={48} />
                <div style={{ textAlign: "center" }}>
                    <h1 className="ks-page__title ks-page__title--sm">
                        {isAttached
                            ? "Picking up your review…"
                            : "Generating commentary…"}
                    </h1>
                    <p
                        className="ks-page__lead"
                        role="status"
                        aria-live="polite"
                    >
                        {progress === null
                            ? "Finding the key moments…"
                            : `Move ${progress.done} of ${progress.total} key moments`}
                    </p>
                </div>

                <Panel style={{ width: "100%" }}>
                    <Progress
                        label="Review progress"
                        value={progress?.done}
                        max={progress?.total}
                        valueText={
                            progress === null
                                ? "Finding the key moments"
                                : `Move ${progress.done} of ${progress.total}`
                        }
                    />
                    <p
                        className="ks-page__meta"
                        style={{ marginTop: "var(--space-9)" }}
                    >
                        {isAttached
                            ? "A review was already running on your account — this is that one."
                            : "You can close this tab; the review keeps going and lands in History."}
                    </p>
                </Panel>

                <Button
                    variant="outline"
                    tone="danger"
                    onClick={() => {
                        stopWatching();
                        toast.info(
                            "Stopped watching. The review keeps running and will appear in History."
                        );
                    }}
                >
                    Stop watching
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
                            {/*
                                What the run actually cost, and which model wrote
                                it. Both are typed and persisted, and the panel has
                                always shown them — the website rendered neither,
                                so it never told the user what they had spent.
                            */}
                            {result.model
                                ? ` · ${CLAUDE_MODEL_LABELS[result.model]}`
                                : ""}
                            {result.usage
                                ? ` · ${(
                                      result.usage.input_tokens +
                                      result.usage.output_tokens
                                  ).toLocaleString()} tokens`
                                : ""}
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
                                setMoveCount(undefined);
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
                        moveCount={moveCount}
                    />
                </div>
            </div>
        </div>
    );
}
