"""Deterministic Go board primitives.

This is the foundation the concept classifiers (contact play, atari, cut, ladder,
shape patterns, ...) sit on. It computes board facts with certainty; it does not
interpret them. There is deliberately nothing here about territory, life and death,
KataGo, SGF parsing, or prompts.

Pure computation: no I/O, no logging, no network, standard library only.

Coordinate convention
---------------------
Internally a point is ``Point(row, col)``, 0-indexed, with **row 0 at the bottom
edge** and **col 0 at the left edge**. That is sgfmill's convention, which the rest
of the backend already uses (see the helpers in :mod:`app.services.katago`), so
sgfmill move tuples are usable here unchanged.

Three external conventions meet at this boundary and they do not share an alphabet:

===================  ===========  =====================================================
Convention           Example      Notes
===================  ===========  =====================================================
SGF                  ``dd``       letters ``a``-``z``, **includes** ``i``, origin top-left
Go / KataGo / GTP    ``D6``       columns ``A``-``T``, **skips** ``I``, row 1 at bottom
Internal             ``(3, 3)``   0-indexed, row 0 at bottom
===================  ===========  =====================================================

Because SGF's origin is at the top-left and ours is at the bottom-left, the SGF
converters invert the row; the Go-notation converters do not. The two alphabets are
kept in separate constants on purpose — sharing one produces an off-by-one on every
column from ``I`` onward.

Design choices
--------------
* ``Color`` has only ``BLACK`` and ``WHITE``. Empty is ``None`` in the grid. That
  keeps :attr:`Color.opponent` total (there is no sensible ``EMPTY.opponent``) and
  makes "is this point empty" a plain ``is None`` test. It also matches sgfmill,
  whose ``Board.get`` returns ``None`` for an empty point.
* A pass is the explicit :data:`PASS` sentinel, not ``None`` — ``None`` already
  means "empty" in the grid and reusing it for "no move" invites confusion.
* :meth:`Board.place_move` returns a new :class:`Board`; boards are never mutated.
  Detectors compare before/after states and replay KataGo principal variations
  speculatively, and both are error-prone against a mutable board.
* Ko is *simple ko* only. The forbidden point is stored as :attr:`Board.ko_point`
  rather than checked against a hard-coded one-position lookback, and
  :meth:`Board.position_key` exposes the hashable position so a caller can maintain
  its own history and layer positional superko on top without changing this module.
"""

from __future__ import annotations

import string
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from enum import Enum
from functools import cache
from typing import Final, NamedTuple, final

__all__ = [
    "MAX_BOARD_SIZE",
    "PASS",
    "Board",
    "BoardError",
    "Chain",
    "Color",
    "EmptyPointError",
    "IllegalMoveError",
    "InvalidCoordinateError",
    "KoError",
    "Move",
    "MoveResult",
    "OccupiedPointError",
    "OffBoardPointError",
    "PassType",
    "Point",
    "SetupConflictError",
    "SuicideError",
    "move_from_go_notation",
    "move_from_sgf",
    "move_to_go_notation",
    "move_to_sgf",
    "point_from_go_notation",
    "point_from_sgf",
    "point_to_go_notation",
    "point_to_sgf",
]

# SGF uses a plain alphabet and *does* include "i".
_SGF_LETTERS: Final = string.ascii_lowercase
# Go/GTP/KataGo notation omits "I" by convention, to avoid confusion with "J" and "1".
_GO_COLUMNS: Final = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

#: Largest board this module can label. Bounded by the Go-notation alphabet, which
#: runs out at 25 columns once ``I`` is dropped.
MAX_BOARD_SIZE: Final = len(_GO_COLUMNS)


# ── Errors ────────────────────────────────────────────────────────────────────
#
# These stay here rather than in ``app.errors``: that module imports FastAPI and
# maps failures onto HTTP responses, and these are pure domain errors raised deep
# inside computation that has no idea it is serving a request.


class BoardError(Exception):
    """Base class for every error raised by this module."""


class InvalidCoordinateError(BoardError, ValueError):
    """A coordinate string was malformed or out of range for the board size."""


class OffBoardPointError(BoardError, ValueError):
    """A :class:`Point` lies outside the board."""


class EmptyPointError(BoardError, ValueError):
    """A stone was expected at a point that is empty."""


class SetupConflictError(BoardError, ValueError):
    """The same point was assigned two different states in one setup call."""


class IllegalMoveError(BoardError):
    """Base class for moves the rules forbid."""


class OccupiedPointError(IllegalMoveError):
    """A move was played onto an occupied point."""


class SuicideError(IllegalMoveError):
    """The played chain would have zero liberties once captures are resolved."""


class KoError(IllegalMoveError):
    """The move would immediately recapture in a simple ko."""


# ── Core types ────────────────────────────────────────────────────────────────


class Color(Enum):
    """A stone colour. Empty points are ``None``, not a member of this enum.

    The values are sgfmill's colour strings, so ``Color("b")`` and
    ``color.value`` interoperate with sgfmill directly.
    """

    BLACK = "b"
    WHITE = "w"

    @property
    def opponent(self) -> Color:
        return Color.WHITE if self is Color.BLACK else Color.BLACK

    @classmethod
    def from_letter(cls, letter: str) -> Color:
        """Parse ``"b"``/``"B"`` or ``"w"``/``"W"`` (SGF and KataGo differ in case)."""
        try:
            return cls(letter.lower())
        except ValueError as exc:
            raise InvalidCoordinateError(
                f"expected a colour letter 'b' or 'w', got {letter!r}"
            ) from exc


class Point(NamedTuple):
    """An immutable, hashable board coordinate. Row 0 is the bottom edge."""

    row: int
    col: int


@final
class PassType:
    """The type of the :data:`PASS` sentinel. Not instantiable a second time."""

    __slots__ = ()
    _instance: PassType | None = None

    def __new__(cls) -> PassType:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "PASS"


#: A pass. Legal at any time; leaves the position untouched and clears any ko ban.
PASS: Final = PassType()

#: Either a point on the board or a pass.
type Move = Point | PassType


@dataclass(frozen=True, slots=True)
class Chain:
    """A maximal set of same-colour stones connected orthogonally.

    Hashable: ``points`` is a ``frozenset``. Diagonals do not connect stones.
    """

    color: Color
    points: frozenset[Point]

    def __len__(self) -> int:
        return len(self.points)

    def __iter__(self) -> Iterator[Point]:
        return iter(self.points)

    def __contains__(self, point: Point) -> bool:
        return point in self.points


@dataclass(frozen=True, slots=True)
class MoveResult:
    """Everything a caller needs to know about a completed move.

    ``chain_after`` and ``liberties_after`` describe the played chain *after*
    captures are resolved, and are ``None`` for a pass. They are recorded here so
    that a detector never has to re-derive the immediate consequences of the move
    from the new board.
    """

    board: Board
    color: Color
    move: Move
    captured: frozenset[Point]
    captured_chains: tuple[Chain, ...]
    chain_after: Chain | None
    liberties_after: frozenset[Point] | None

    @property
    def is_pass(self) -> bool:
        return self.move is PASS

    @property
    def is_capture(self) -> bool:
        return bool(self.captured)

    @property
    def capture_count(self) -> int:
        return len(self.captured)

    @property
    def liberty_count(self) -> int | None:
        """Liberties of the played chain, or ``None`` for a pass."""
        return None if self.liberties_after is None else len(self.liberties_after)

    @property
    def is_self_atari(self) -> bool:
        """The played chain has exactly one liberty. Legal, and worth reporting.

        Distinct from suicide (zero liberties), which raises :class:`SuicideError`
        and so never produces a ``MoveResult``.
        """
        return self.liberties_after is not None and len(self.liberties_after) == 1

    @property
    def ko_point(self) -> Point | None:
        """The point the *next* player may not play, if this move created a ko."""
        return self.board.ko_point


# ── Coordinate conversion ─────────────────────────────────────────────────────


def _validate_size(board_size: int) -> None:
    if not 1 <= board_size <= MAX_BOARD_SIZE:
        raise InvalidCoordinateError(
            f"board size must be between 1 and {MAX_BOARD_SIZE}, got {board_size}"
        )


def _validate_point(point: Point, board_size: int) -> None:
    if not (0 <= point.row < board_size and 0 <= point.col < board_size):
        raise OffBoardPointError(f"{point!r} is outside a {board_size}x{board_size} board")


def point_from_sgf(coord: str, board_size: int) -> Point:
    """Parse an SGF coordinate such as ``"dd"``.

    SGF letters run ``a``-``z`` and include ``i``; the origin is the **top-left**,
    so the row is inverted on the way in.
    """
    _validate_size(board_size)
    if len(coord) != 2:
        raise InvalidCoordinateError(f"an SGF coordinate is two letters, got {coord!r}")
    col_letter, row_letter = coord
    if col_letter not in _SGF_LETTERS or row_letter not in _SGF_LETTERS:
        raise InvalidCoordinateError(f"SGF coordinates are lowercase a-z, got {coord!r}")
    col = _SGF_LETTERS.index(col_letter)
    sgf_row = _SGF_LETTERS.index(row_letter)
    if col >= board_size or sgf_row >= board_size:
        raise InvalidCoordinateError(f"{coord!r} is outside a {board_size}x{board_size} board")
    return Point(board_size - 1 - sgf_row, col)


def point_to_sgf(point: Point, board_size: int) -> str:
    """Inverse of :func:`point_from_sgf`."""
    _validate_size(board_size)
    _validate_point(point, board_size)
    return f"{_SGF_LETTERS[point.col]}{_SGF_LETTERS[board_size - 1 - point.row]}"


def point_from_go_notation(coord: str, board_size: int) -> Point:
    """Parse Go/GTP/KataGo notation such as ``"D6"`` or ``"Q16"``.

    Columns run ``A``-``T`` **skipping** ``I``; row 1 is at the bottom, which is
    already our row 0, so no inversion happens here.
    """
    _validate_size(board_size)
    text = coord.strip().upper()
    if len(text) < 2:
        raise InvalidCoordinateError(f"{coord!r} is not a Go coordinate")
    col_letter, digits = text[0], text[1:]
    if col_letter == "I":
        raise InvalidCoordinateError(
            f"{coord!r} is invalid: Go notation has no column 'I' (H is followed by J)"
        )
    if col_letter not in _GO_COLUMNS:
        raise InvalidCoordinateError(f"{coord!r} has no valid column letter")
    if not digits.isdigit():
        raise InvalidCoordinateError(f"{coord!r} has a malformed row number")
    col = _GO_COLUMNS.index(col_letter)
    row = int(digits) - 1
    if col >= board_size or not 0 <= row < board_size:
        raise InvalidCoordinateError(f"{coord!r} is outside a {board_size}x{board_size} board")
    return Point(row, col)


def point_to_go_notation(point: Point, board_size: int) -> str:
    """Inverse of :func:`point_from_go_notation`."""
    _validate_size(board_size)
    _validate_point(point, board_size)
    return f"{_GO_COLUMNS[point.col]}{point.row + 1}"


def move_from_sgf(coord: str, board_size: int) -> Move:
    """Like :func:`point_from_sgf`, but maps SGF's pass encodings to :data:`PASS`.

    An empty value is the modern pass. ``"tt"`` is the FF[3]-era pass, and is only
    read as one on boards of 19 or less, where it cannot be a real point.
    """
    _validate_size(board_size)
    if coord == "":
        return PASS
    if coord == "tt" and board_size <= 19:
        return PASS
    return point_from_sgf(coord, board_size)


def move_to_sgf(move: Move, board_size: int) -> str:
    """Inverse of :func:`move_from_sgf`; a pass becomes the empty string."""
    _validate_size(board_size)
    if move is PASS:
        return ""
    if not isinstance(move, Point):
        raise TypeError(f"expected a Point or PASS, got {move!r}")
    return point_to_sgf(move, board_size)


def move_from_go_notation(coord: str, board_size: int) -> Move:
    """Like :func:`point_from_go_notation`, but accepts KataGo's ``"pass"``."""
    _validate_size(board_size)
    if coord.strip().lower() == "pass":
        return PASS
    return point_from_go_notation(coord, board_size)


def move_to_go_notation(move: Move, board_size: int) -> str:
    """Inverse of :func:`move_from_go_notation`; a pass becomes ``"pass"``."""
    _validate_size(board_size)
    if move is PASS:
        return "pass"
    if not isinstance(move, Point):
        raise TypeError(f"expected a Point or PASS, got {move!r}")
    return point_to_go_notation(move, board_size)


# ── Internal lookup tables ────────────────────────────────────────────────────
#
# The grid is a flat tuple indexed ``row * size + col``. Neighbours and points are
# precomputed per board size so the flood fill neither re-derives edge conditions
# nor allocates a Point per step. Everything below is keyed on flat indices; Points
# only reappear at the public boundary.


@cache
def _point_table(size: int) -> tuple[Point, ...]:
    return tuple(Point(row, col) for row in range(size) for col in range(size))


@cache
def _neighbor_table(size: int) -> tuple[tuple[int, ...], ...]:
    table: list[tuple[int, ...]] = []
    for row in range(size):
        for col in range(size):
            adjacent: list[int] = []
            if row > 0:
                adjacent.append((row - 1) * size + col)
            if row + 1 < size:
                adjacent.append((row + 1) * size + col)
            if col > 0:
                adjacent.append(row * size + col - 1)
            if col + 1 < size:
                adjacent.append(row * size + col + 1)
            table.append(tuple(adjacent))
    return tuple(table)


type _Grid = tuple[Color | None, ...]

# The helpers below read the grid by index only, so they accept the mutable list
# ``place_move`` builds as well as a finished tuple. That matters: resolving
# captures would otherwise copy the whole board once per adjacent enemy chain.
type _ReadableGrid = Sequence[Color | None]


def _flood(grid: _ReadableGrid, start: int, neighbors: tuple[tuple[int, ...], ...]) -> set[int]:
    """Indices of the chain containing ``start``. Assumes ``grid[start]`` is a stone."""
    color = grid[start]
    seen = {start}
    stack = [start]
    while stack:
        index = stack.pop()
        for adjacent in neighbors[index]:
            if adjacent not in seen and grid[adjacent] is color:
                seen.add(adjacent)
                stack.append(adjacent)
    return seen


def _liberties(
    grid: _ReadableGrid, indices: Iterable[int], neighbors: tuple[tuple[int, ...], ...]
) -> set[int]:
    """Empty points adjacent to ``indices``. A shared liberty is counted once."""
    liberties: set[int] = set()
    for index in indices:
        for adjacent in neighbors[index]:
            if grid[adjacent] is None:
                liberties.add(adjacent)
    return liberties


# ── Board ─────────────────────────────────────────────────────────────────────


class Board:
    """An immutable Go position.

    Every method that would change the position returns a new ``Board``; the
    receiver is never modified.
    """

    __slots__ = ("_grid", "_ko_point", "_neighbors", "_points", "_size", "_to_play")

    def __init__(self, size: int) -> None:
        _validate_size(size)
        self._size = size
        self._grid: _Grid = (None,) * (size * size)
        self._ko_point: Point | None = None
        self._to_play = Color.BLACK
        self._points = _point_table(size)
        self._neighbors = _neighbor_table(size)

    # -- construction ---------------------------------------------------------

    @classmethod
    def _derive(cls, size: int, grid: _Grid, ko_point: Point | None, to_play: Color) -> Board:
        board = cls.__new__(cls)
        board._size = size
        board._grid = grid
        board._ko_point = ko_point
        board._to_play = to_play
        board._points = _point_table(size)
        board._neighbors = _neighbor_table(size)
        return board

    # -- state ----------------------------------------------------------------

    @property
    def size(self) -> int:
        return self._size

    @property
    def to_play(self) -> Color:
        """Whose turn it is. Advanced by :meth:`place_move`, including on a pass."""
        return self._to_play

    @property
    def ko_point(self) -> Point | None:
        """The point :attr:`to_play` may not play because of a simple ko."""
        return self._ko_point

    def position_key(self) -> tuple[int, _Grid]:
        """A hashable identity for the *stones only*.

        Excludes ko state and side to move, so a caller can keep a history of these
        and implement positional superko without this module changing.
        """
        return (self._size, self._grid)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Board):
            return NotImplemented
        return (
            self._size == other._size
            and self._grid == other._grid
            and self._ko_point == other._ko_point
            and self._to_play == other._to_play
        )

    def __hash__(self) -> int:
        return hash((self._size, self._grid, self._ko_point, self._to_play))

    def __repr__(self) -> str:
        stones = sum(1 for value in self._grid if value is not None)
        return f"<Board {self._size}x{self._size} stones={stones} to_play={self._to_play.name}>"

    def __str__(self) -> str:
        return self.to_ascii()

    def to_ascii(self) -> str:
        """Render the board top row first: ``.`` empty, ``X`` black, ``O`` white."""
        symbols = {None: ".", Color.BLACK: "X", Color.WHITE: "O"}
        return "\n".join(
            " ".join(symbols[self._grid[row * self._size + col]] for col in range(self._size))
            for row in reversed(range(self._size))
        )

    # -- queries --------------------------------------------------------------

    def _index(self, point: Point) -> int:
        _validate_point(point, self._size)
        return point.row * self._size + point.col

    def is_on_board(self, point: Point) -> bool:
        return 0 <= point.row < self._size and 0 <= point.col < self._size

    def get(self, point: Point) -> Color | None:
        """The colour at ``point``, or ``None`` when it is empty."""
        return self._grid[self._index(point)]

    def is_empty(self, point: Point) -> bool:
        return self._grid[self._index(point)] is None

    def points(self) -> tuple[Point, ...]:
        """Every point on the board, bottom row first."""
        return self._points

    def stones(self) -> Iterator[tuple[Point, Color]]:
        """Every occupied point with its colour."""
        for index, color in enumerate(self._grid):
            if color is not None:
                yield self._points[index], color

    def neighbors(self, point: Point) -> tuple[Point, ...]:
        """The orthogonally adjacent points: four in the centre, three on an edge,
        two in a corner. Diagonals are not neighbours and never connect stones."""
        return tuple(self._points[index] for index in self._neighbors[self._index(point)])

    def chain_at(self, point: Point) -> Chain:
        """The connected same-colour group containing ``point``.

        Raises :class:`EmptyPointError` if the point is empty — a chain of no
        stones is not a meaningful answer.
        """
        index = self._index(point)
        color = self._grid[index]
        if color is None:
            raise EmptyPointError(f"no stone at {point!r}")
        indices = _flood(self._grid, index, self._neighbors)
        return Chain(color=color, points=frozenset(self._points[i] for i in indices))

    def chains(self) -> tuple[Chain, ...]:
        """Every chain on the board, each reported once."""
        seen: set[int] = set()
        found: list[Chain] = []
        for index, color in enumerate(self._grid):
            if color is None or index in seen:
                continue
            indices = _flood(self._grid, index, self._neighbors)
            seen |= indices
            found.append(Chain(color=color, points=frozenset(self._points[i] for i in indices)))
        return tuple(found)

    def liberties(self, chain: Chain) -> frozenset[Point]:
        """The empty points adjacent to ``chain``. Shared liberties count once.

        Raises :class:`EmptyPointError` if the chain does not match this board,
        which is what a stale chain from a previous position looks like.
        """
        indices: list[int] = []
        for point in chain.points:
            index = self._index(point)
            if self._grid[index] is not chain.color:
                raise EmptyPointError(
                    f"{point!r} does not hold a {chain.color.name} stone on this board"
                )
            indices.append(index)
        return frozenset(self._points[i] for i in _liberties(self._grid, indices, self._neighbors))

    def liberty_count(self, point: Point) -> int:
        """Liberties of the chain at ``point``. Convenience for atari checks."""
        return len(self.liberties(self.chain_at(point)))

    # -- transitions ----------------------------------------------------------

    def with_to_play(self, color: Color) -> Board:
        """A copy with the side to move overridden (e.g. after handicap setup)."""
        return Board._derive(self._size, self._grid, self._ko_point, color)

    def place_setup_stones(
        self,
        *,
        black: Iterable[Point] = (),
        white: Iterable[Point] = (),
        empty: Iterable[Point] = (),
    ) -> Board:
        """Place handicap or SGF ``AB``/``AW``/``AE`` stones.

        Deliberately not part of :meth:`place_move`: setup stones resolve no
        captures, cannot be suicide, do not alternate the turn, and overwrite
        whatever was on the point. Any ko ban is cleared. Use
        :meth:`with_to_play` to say who moves next after a handicap.

        Raises :class:`SetupConflictError` if a point is listed more than once.
        """
        assignments: dict[int, Color | None] = {}
        for points, color in ((black, Color.BLACK), (white, Color.WHITE), (empty, None)):
            for point in points:
                index = self._index(point)
                if index in assignments and assignments[index] is not color:
                    raise SetupConflictError(f"{point!r} was assigned two states in one setup")
                assignments[index] = color
        if not assignments:
            return self
        grid = list(self._grid)
        for index, color in assignments.items():
            grid[index] = color
        return Board._derive(self._size, tuple(grid), None, self._to_play)

    def place_move(self, move: Move, color: Color | None = None) -> MoveResult:
        """Play ``move``, returning the new board and what the move did.

        ``color`` defaults to :attr:`to_play`. The order of operations is fixed and
        matters: the stone goes down, **then** opponent chains with no liberties are
        removed, and only **then** is the played chain's own liberty count judged. A
        move that looks suicidal is legal when it captures first.

        Raises :class:`OccupiedPointError`, :class:`KoError`, or
        :class:`SuicideError`. A move leaving the played chain on exactly one
        liberty is self-atari: legal, and reported by
        :attr:`MoveResult.is_self_atari`.
        """
        mover = self._to_play if color is None else color

        if move is PASS:
            return MoveResult(
                board=Board._derive(self._size, self._grid, None, mover.opponent),
                color=mover,
                move=PASS,
                captured=frozenset(),
                captured_chains=(),
                chain_after=None,
                liberties_after=None,
            )

        if not isinstance(move, Point):
            raise TypeError(f"expected a Point or PASS, got {move!r}")

        index = self._index(move)
        if self._grid[index] is not None:
            raise OccupiedPointError(
                f"{move!r} is already occupied by {self._grid[index].name}"  # type: ignore[union-attr]
            )
        if move == self._ko_point and mover is self._to_play:
            raise KoError(f"{move!r} is forbidden: it would immediately retake the ko")

        grid = list(self._grid)
        grid[index] = mover

        # Step 2: remove opponent chains left with no liberties.
        opponent = mover.opponent
        captured_indices: set[int] = set()
        captured_chains: list[Chain] = []
        for adjacent in self._neighbors[index]:
            if grid[adjacent] is not opponent or adjacent in captured_indices:
                continue
            chain_indices = _flood(grid, adjacent, self._neighbors)
            if _liberties(grid, chain_indices, self._neighbors):
                continue
            captured_indices |= chain_indices
            captured_chains.append(
                Chain(color=opponent, points=frozenset(self._points[i] for i in chain_indices))
            )
            for chain_index in chain_indices:
                grid[chain_index] = None

        # Step 3: only now judge the played chain.
        new_grid: _Grid = tuple(grid)
        own_indices = _flood(new_grid, index, self._neighbors)
        own_liberties = _liberties(new_grid, own_indices, self._neighbors)
        if not own_liberties:
            raise SuicideError(
                f"{move!r} is suicide: the {mover.name} chain would have no liberties"
            )

        # Simple ko: a lone stone that takes exactly one stone and is itself left on
        # exactly one liberty has recreated the position the opponent just left.
        ko_point: Point | None = None
        if len(captured_indices) == 1 and len(own_indices) == 1 and len(own_liberties) == 1:
            ko_point = self._points[next(iter(captured_indices))]

        return MoveResult(
            board=Board._derive(self._size, new_grid, ko_point, opponent),
            color=mover,
            move=move,
            captured=frozenset(self._points[i] for i in captured_indices),
            captured_chains=tuple(captured_chains),
            chain_after=Chain(color=mover, points=frozenset(self._points[i] for i in own_indices)),
            liberties_after=frozenset(self._points[i] for i in own_liberties),
        )
