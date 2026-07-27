"""Wall-clock cost of replaying a full game with the board primitives.

Deliberately outside ``tests/`` — ``pyproject.toml`` sets ``testpaths = ["tests"]``,
so pytest never collects this, and a timing number is not something CI should be
able to fail on.

Run it with::

    cd backend && PYTHONPATH=. uv run python benchmarks/board_benchmark.py

(``PYTHONPATH`` is needed because ``app`` is not installed as a package; pytest gets
the same effect from ``pythonpath = ["."]`` in ``pyproject.toml``.)

The point is to justify the straightforward flood fill in ``app.services.board``
rather than reaching for union-find or incremental chain tracking. A full review is
~250 moves and Tier 1-3 detectors call these primitives a handful of times per move,
so the budget is low thousands of ``chain_at`` calls per game, not millions.
"""

import time

from app.services.board import Board, IllegalMoveError, Point

BOARD_SIZE = 19
GAME_LENGTH = 250
# 197 shares no factor with 361 (= 19 x 19), so stepping by it visits every point
# exactly once. That scatters the stones the way a real game does, without pulling
# in a random seed or an SGF fixture.
_STRIDE = 197


def _scattered_points(size: int) -> list[Point]:
    total = size * size
    return [
        Point((i * _STRIDE % total) // size, (i * _STRIDE % total) % size) for i in range(total)
    ]


def replay_game(moves: int = GAME_LENGTH) -> tuple[Board, int]:
    """Play ``moves`` legal moves, returning the final board and the count played."""
    board = Board(BOARD_SIZE)
    played = 0
    for point in _scattered_points(BOARD_SIZE):
        if played == moves:
            break
        try:
            board = board.place_move(point).board
        except IllegalMoveError:
            continue
        played += 1
    return board, played


def inspect_every_stone(board: Board) -> int:
    """What a detector sweep costs: one ``chain_at`` + ``liberties`` per stone."""
    liberties = 0
    for point, _color in board.stones():
        liberties += len(board.liberties(board.chain_at(point)))
    return liberties


def main() -> None:
    start = time.perf_counter()
    board, played = replay_game()
    replay_seconds = time.perf_counter() - start

    start = time.perf_counter()
    inspect_every_stone(board)
    sweep_seconds = time.perf_counter() - start

    stones = sum(1 for _ in board.stones())
    print(f"replay:  {played} moves in {replay_seconds * 1000:.1f} ms")
    print(f"sweep:   {stones} stones inspected in {sweep_seconds * 1000:.1f} ms")
    print(f"per-move budget for one full sweep: {sweep_seconds * 1000 / max(played, 1):.3f} ms")


if __name__ == "__main__":
    main()
