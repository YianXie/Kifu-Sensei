import { useEffect, useRef } from "react";

import { GameMove, isValidMove } from "@/types/game";

export default function MiniBoardThumb({
    boardSize,
    moves,
    initialStones = [],
    size = 88,
}: {
    boardSize: number;
    moves: GameMove[];
    initialStones?: GameMove[];
    size?: number;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.scale(dpr, dpr);

        const PAD = size * 0.075;
        const step = (size - PAD * 2) / (boardSize - 1);
        const r = step * 0.44;

        // Board fill
        ctx.fillStyle = "#DCB35C";
        ctx.fillRect(0, 0, size, size);

        // Grid lines
        for (let i = 0; i < boardSize; i++) {
            ctx.lineWidth = i === 0 || i === boardSize - 1 ? 1.1 : 0.6;
            ctx.strokeStyle = "rgba(0,0,0,0.65)";
            const p = PAD + i * step;
            ctx.beginPath();
            ctx.moveTo(p, PAD);
            ctx.lineTo(p, size - PAD);
            ctx.moveTo(PAD, p);
            ctx.lineTo(size - PAD, p);
            ctx.stroke();
        }

        // Star points
        const starMap: Record<number, number[]> = {
            19: [3, 9, 15],
            13: [3, 6, 9],
            9: [2, 4, 6],
        };
        const starPts = starMap[boardSize] ?? [];
        starPts.forEach((i) =>
            starPts.forEach((j) => {
                ctx.beginPath();
                ctx.arc(
                    PAD + i * step,
                    PAD + j * step,
                    Math.max(1.5, step * 0.09),
                    0,
                    Math.PI * 2
                );
                ctx.fillStyle = "rgba(0,0,0,0.65)";
                ctx.fill();
            })
        );

        // Collect final stone positions (simple overlay, no capture)
        const signMap = new Map<string, 1 | -1>();

        function place(move: GameMove) {
            if (!isValidMove(move)) return;
            const [color, [row, col]] = move;
            const sign: 1 | -1 = color.toUpperCase() === "B" ? 1 : -1;
            signMap.set(`${row},${col}`, sign);
        }

        initialStones.forEach(place);
        moves.forEach(place);

        // Draw stones
        signMap.forEach((sign, key) => {
            const [row, col] = key.split(",").map(Number);
            const cx = PAD + col * step;
            const cy = PAD + (boardSize - 1 - row) * step;
            const rr = r - 0.5;
            const isBlack = sign === 1;

            const grad = ctx.createRadialGradient(
                cx - rr * 0.28,
                cy - rr * 0.28,
                rr * 0.04,
                cx,
                cy,
                rr
            );
            if (isBlack) {
                grad.addColorStop(0, "#5c5c5c");
                grad.addColorStop(1, "#0f0f0f");
            } else {
                grad.addColorStop(0, "#ffffff");
                grad.addColorStop(1, "#c6c6c6");
            }

            ctx.beginPath();
            ctx.arc(cx, cy, rr, 0, Math.PI * 2);
            if (!isBlack) {
                ctx.strokeStyle = "#aaaaaa";
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
            ctx.fillStyle = grad;
            ctx.fill();
        });
    }, [boardSize, moves, initialStones, size]);

    return (
        <canvas
            ref={canvasRef}
            className="ks-minithumb"
            width={size}
            height={size}
            style={{ width: size, height: size }}
            aria-hidden="true"
        />
    );
}
