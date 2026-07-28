"""Shared helper for building board positions from ASCII diagrams.

A plain module rather than a fixture in ``conftest.py``: nearly every board test
needs it, and threading it through as a fixture argument would add a parameter to
several dozen test signatures for no gain. ``tests`` has no ``__init__.py``, so
pytest puts this directory on ``sys.path`` and ``from board_fixtures import ...``
resolves.
"""

from app.services.board import Board, Color, Point

_SYMBOLS = {"X": Color.BLACK, "O": Color.WHITE, ".": None}


def board_from_ascii(diagram: str, *, to_play: Color = Color.BLACK) -> Board:
    """Build a board from a diagram whose first line is the *top* row.

    ``.`` empty, ``X`` black, ``O`` white. Whitespace within a row is ignored, so
    both ``"X O ."`` and ``"XO."`` work. Stones are placed as setup stones: no
    captures are resolved, so a diagram may legitimately contain a shape that no
    sequence of legal moves could reach.
    """
    rows = [line.replace(" ", "") for line in diagram.strip().splitlines()]
    rows = [row for row in rows if row]
    size = len(rows)
    if any(len(row) != size for row in rows):
        raise ValueError("diagram must be square")

    black: list[Point] = []
    white: list[Point] = []
    for display_row, row in enumerate(rows):
        for col, symbol in enumerate(row):
            color = _SYMBOLS[symbol]
            # The first line is the top row, i.e. the highest internal row index.
            point = Point(size - 1 - display_row, col)
            if color is Color.BLACK:
                black.append(point)
            elif color is Color.WHITE:
                white.append(point)
    return Board(size).place_setup_stones(black=black, white=white).with_to_play(to_play)
