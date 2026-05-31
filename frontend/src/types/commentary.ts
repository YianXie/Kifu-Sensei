import type { GameMove } from "@/types/game";

export type CommentaryItem = {
    turn: number;
    comment: string;
};

export type CommentaryResponse = {
    board_size: number;
    moves: GameMove[];
    initial_stones: GameMove[];
    comments: CommentaryItem[];
};
