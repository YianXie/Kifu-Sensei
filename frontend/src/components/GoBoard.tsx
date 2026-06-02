import Board from "@sabaki/go-board";

import { useCallback, useEffect, useRef, useState } from "react";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { GTP_LETTERS } from "@/constants";
import { type GameMove, isValidMove } from "@/types/game";

const CANVAS_SIZE = 800;
const PADDING = 50;

type GoBoardProps = {
    boardSize: number;
    moves: GameMove[];
    initialStones?: GameMove[];
    commentsByTurn: Record<number, string>;
    currentMoveIndex: number;
    onMoveIndexChange: (index: number) => void;
};

export default function GoBoard({
    boardSize,
    moves,
    initialStones = [],
    commentsByTurn,
    currentMoveIndex,
    onMoveIndexChange,
}: GoBoardProps) {
    const margin = (CANVAS_SIZE - PADDING * 2) / (boardSize - 1);
    const stoneRadius = margin / 2;

    const gameRef = useRef(Board.fromDimensions(boardSize));
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [boardImageData, setBoardImageData] = useState<ImageData | null>(
        null
    );
    const [scrollKeyIsPressed, setScrollKeyIsPressed] = useState(false);

    const currentComment = commentsByTurn[currentMoveIndex] ?? null;

    const onMoveChange = useCallback(
        (amount: number) => {
            const next = currentMoveIndex + amount;
            onMoveIndexChange(Math.max(0, Math.min(next, moves.length)));
        },
        [currentMoveIndex, moves.length, onMoveIndexChange]
    );

    const boardToCanvasCoords = (row: number, col: number) => {
        return [
            margin * col + PADDING,
            (boardSize - row - 1) * margin + PADDING,
        ] as const;
    };

    const buildBoardAtMove = useCallback(
        (moveIndex: number) => {
            let g = Board.fromDimensions(boardSize);
            for (const stone of initialStones) {
                if (!isValidMove(stone)) continue;
                const [color, [row, col]] = stone;
                const sign = color.toUpperCase() === "B" ? 1 : -1;
                g = g.makeMove(sign, [row, col]);
            }
            for (let i = 0; i < Math.min(moveIndex, moves.length); i++) {
                const move = moves[i];
                if (!move || !isValidMove(move)) continue;
                const [color, [row, col]] = move;
                const sign = color.toUpperCase() === "B" ? 1 : -1;
                const check = g.analyzeMove(sign, [row, col]);
                if (!check.suicide && !check.ko && !check.overwrite) {
                    g = g.makeMove(sign, [row, col]);
                }
            }
            return g;
        },
        [boardSize, initialStones, moves]
    );

    const drawBoard = (canvasContext: CanvasRenderingContext2D) => {
        canvasContext.fillStyle = "#DCB35C";
        canvasContext.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        for (let i = 0; i < boardSize; i++) {
            canvasContext.strokeStyle = "#333";
            canvasContext.lineWidth =
                i === 0 || i === boardSize - 1 ? 1.25 : 0.75;

            canvasContext.beginPath();
            canvasContext.moveTo(PADDING + margin * i, PADDING);
            canvasContext.lineTo(PADDING + margin * i, CANVAS_SIZE - PADDING);
            canvasContext.moveTo(PADDING, PADDING + margin * i);
            canvasContext.lineTo(CANVAS_SIZE - PADDING, PADDING + margin * i);
            canvasContext.stroke();
            canvasContext.closePath();

            if (boardSize === 19 && [3, 9, 15].includes(i)) {
                for (let x = 0; x < 3; x++) {
                    canvasContext.beginPath();
                    canvasContext.arc(
                        PADDING + margin * i,
                        PADDING + margin * 3 + margin * 6 * x,
                        stoneRadius / 4,
                        0,
                        2 * Math.PI
                    );
                    canvasContext.fillStyle = "#333";
                    canvasContext.fill();
                    canvasContext.closePath();
                }
            }
        }
    };

    const drawCoords = (canvasContext: CanvasRenderingContext2D) => {
        canvasContext.font = "15px Arial";
        canvasContext.textBaseline = "middle";
        canvasContext.textAlign = "center";
        canvasContext.fillStyle = "#222";

        for (let i = 0; i < boardSize; i++) {
            const letter = GTP_LETTERS[i] ?? String(i + 1);
            canvasContext.fillText(
                letter,
                PADDING + margin * i,
                CANVAS_SIZE - PADDING / 2
            );
            canvasContext.fillText(letter, PADDING + margin * i, PADDING / 2);
            canvasContext.fillText(
                String(i + 1),
                CANVAS_SIZE - PADDING / 2,
                CANVAS_SIZE - PADDING - margin * i
            );
            canvasContext.fillText(
                String(i + 1),
                PADDING / 2,
                CANVAS_SIZE - PADDING - margin * i
            );
        }
    };

    const drawStone = (
        canvasContext: CanvasRenderingContext2D,
        row: number,
        col: number,
        color: string,
        highlight = false
    ) => {
        const [canvasX, canvasY] = boardToCanvasCoords(row, col);
        canvasContext.fillStyle = color;
        canvasContext.beginPath();
        canvasContext.arc(canvasX, canvasY, stoneRadius - 2, 0, 2 * Math.PI);
        canvasContext.stroke();
        canvasContext.fill();
        canvasContext.closePath();

        if (highlight) {
            canvasContext.beginPath();
            canvasContext.arc(
                canvasX,
                canvasY,
                stoneRadius / 4,
                0,
                2 * Math.PI
            );
            canvasContext.fillStyle = "red";
            canvasContext.fill();
            canvasContext.closePath();
        }
    };

    const drawStones = (canvasContext: CanvasRenderingContext2D) => {
        const lastMove =
            currentMoveIndex > 0 ? moves[currentMoveIndex - 1] : null;
        let lastMoveCoords: [number, number] | null = null;
        if (lastMove && isValidMove(lastMove)) {
            const [, [row, col]] = lastMove;
            lastMoveCoords = [row, col];
        }

        const board = gameRef.current;
        for (let row = 0; row < board.signMap.length; row++) {
            for (let col = 0; col < board.signMap[row].length; col++) {
                const sign = board.get([row, col]);
                if (sign === 0 || sign === null) continue;

                const isHighlighted =
                    lastMoveCoords !== null &&
                    lastMoveCoords[0] === row &&
                    lastMoveCoords[1] === col;

                drawStone(
                    canvasContext,
                    row,
                    col,
                    sign === 1 ? "black" : "white",
                    isHighlighted
                );
            }
        }
    };

    const redrawBoardAndStones = (
        canvasContext: CanvasRenderingContext2D | null
    ) => {
        if (!canvasRef.current || !boardImageData || !canvasContext) return;
        canvasContext.putImageData(boardImageData, 0, 0);
        drawStones(canvasContext);
    };

    useEffect(() => {
        if (boardSize > 19 || boardSize < 2) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const canvasContext = canvas.getContext("2d", {
            willReadFrequently: true,
        });
        if (!canvasContext) return;

        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = CANVAS_SIZE * devicePixelRatio;
        canvas.height = CANVAS_SIZE * devicePixelRatio;
        canvasContext.scale(devicePixelRatio, devicePixelRatio);

        drawBoard(canvasContext);
        drawCoords(canvasContext);
        setBoardImageData(
            canvasContext.getImageData(
                0,
                0,
                CANVAS_SIZE * devicePixelRatio,
                CANVAS_SIZE * devicePixelRatio
            )
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardSize]);

    useEffect(() => {
        gameRef.current = buildBoardAtMove(currentMoveIndex);
        const canvasContext = canvasRef.current?.getContext("2d") ?? null;
        redrawBoardAndStones(canvasContext);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        currentMoveIndex,
        moves,
        initialStones,
        boardImageData,
        buildBoardAtMove,
    ]);

    useEffect(() => {
        const handleWheel = (event: WheelEvent) => {
            if (!scrollKeyIsPressed) return;
            event.preventDefault();
            if (event.deltaY > 0) onMoveChange(1);
            else if (event.deltaY < 0) onMoveChange(-1);
        };

        const handleClick = (event: MouseEvent) => {
            event.preventDefault();
            onMoveChange(1);
        };
        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            onMoveChange(-1);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "ArrowRight") onMoveChange(1);
            else if (event.key === "ArrowLeft") onMoveChange(-1);
            else if (event.key === "Meta" || event.key === "Control") {
                setScrollKeyIsPressed(true);
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Meta" || event.key === "Control") {
                setScrollKeyIsPressed(false);
            }
        };

        const canvas = canvasRef.current;
        canvas?.addEventListener("wheel", handleWheel, { passive: false });
        canvas?.addEventListener("click", handleClick, { passive: false });
        canvas?.addEventListener("contextmenu", handleContextMenu, {
            passive: false,
        });
        window.addEventListener("keydown", handleKeyDown, { passive: true });
        window.addEventListener("keyup", handleKeyUp, { passive: true });

        return () => {
            canvas?.removeEventListener("wheel", handleWheel);
            canvas?.removeEventListener("click", handleClick);
            canvas?.removeEventListener("contextmenu", handleContextMenu);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, [onMoveChange, scrollKeyIsPressed]);

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: { xs: "column", md: "row" },
                gap: 2,
                alignItems: { xs: "flex-start", md: "stretch" },
                width: "100%",
            }}
        >
            <Box
                sx={{
                    flex: "0 0 auto",
                    width: "100%",
                    maxWidth: CANVAS_SIZE,
                    alignSelf: "flex-start",
                }}
            >
                <canvas
                    ref={canvasRef}
                    width={CANVAS_SIZE}
                    height={CANVAS_SIZE}
                    style={{
                        width: "100%",
                        height: "auto",
                        display: "block",
                        maxWidth: `${CANVAS_SIZE}px`,
                        cursor: "pointer",
                    }}
                />
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                >
                    Click / → next move · Right-click / ← previous · Cmd/Ctrl +
                    scroll to step
                </Typography>
            </Box>

            <Paper
                variant="outlined"
                sx={{
                    flex: 1,
                    minWidth: { md: 280 },
                    minHeight: { xs: 200, md: CANVAS_SIZE },
                    maxHeight: { md: CANVAS_SIZE },
                    p: 2,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    overflow: "hidden",
                }}
            >
                <Typography variant="subtitle2" color="text.secondary">
                    Move {currentMoveIndex} / {moves.length}
                </Typography>
                <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
                    {currentComment ? (
                        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                            {currentComment}
                        </Typography>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            {currentMoveIndex === 0
                                ? "Starting position — no commentary for this turn."
                                : "No commentary was generated for this move."}
                        </Typography>
                    )}
                </Box>
            </Paper>
        </Box>
    );
}
