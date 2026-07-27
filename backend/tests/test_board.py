"""The board primitives in ``app.services.board``.

Every later concept classifier inherits any bug that ships here, so the cases that
are easy to get subtly wrong — capture ordering, suicide versus self-atari, ko, and
the three coordinate systems that disagree about both the origin and the alphabet —
are pinned individually rather than incidentally.

Positions are written as ASCII diagrams via :func:`board_from_ascii`: top row first,
``.`` empty, ``X`` black, ``O`` white. That matches :meth:`Board.to_ascii`, so a
failing assertion prints something readable.
"""

import pytest

from app.services.board import (
    MAX_BOARD_SIZE,
    PASS,
    Board,
    Chain,
    Color,
    EmptyPointError,
    InvalidCoordinateError,
    KoError,
    OccupiedPointError,
    OffBoardPointError,
    Point,
    SetupConflictError,
    SuicideError,
    move_from_go_notation,
    move_from_sgf,
    move_to_go_notation,
    move_to_sgf,
    point_from_go_notation,
    point_from_sgf,
    point_to_go_notation,
    point_to_sgf,
)

_SYMBOLS = {"X": Color.BLACK, "O": Color.WHITE, ".": None}


def board_from_ascii(diagram: str, *, to_play: Color = Color.BLACK) -> Board:
    """Build a board from a diagram whose first line is the *top* row.

    Whitespace within a row is ignored, so both ``"X O ."`` and ``"XO."`` work.
    Stones are placed as setup stones: no captures are resolved, so a diagram may
    legitimately contain a shape that no sequence of legal moves could reach.
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


# ── The test helper itself ────────────────────────────────────────────────────


def test_ascii_helper_round_trips() -> None:
    diagram = "\n".join([". X .", "O . O", ". X ."])
    assert board_from_ascii(diagram).to_ascii() == diagram


def test_ascii_helper_puts_the_first_line_at_the_top() -> None:
    board = board_from_ascii(
        """
        X . .
        . . .
        . . O
        """
    )
    # Top-left is the highest row, leftmost column; bottom-right is row 0.
    assert board.get(Point(2, 0)) is Color.BLACK
    assert board.get(Point(0, 2)) is Color.WHITE


# ── Colour ────────────────────────────────────────────────────────────────────


def test_opponent_is_an_involution() -> None:
    assert Color.BLACK.opponent is Color.WHITE
    assert Color.WHITE.opponent is Color.BLACK
    assert Color.BLACK.opponent.opponent is Color.BLACK


@pytest.mark.parametrize(("letter", "expected"), [("b", Color.BLACK), ("W", Color.WHITE)])
def test_color_from_letter_accepts_either_case(letter: str, expected: Color) -> None:
    """SGF writes ``b``/``w`` and KataGo writes ``B``/``W``."""
    assert Color.from_letter(letter) is expected


def test_color_from_letter_rejects_anything_else() -> None:
    with pytest.raises(InvalidCoordinateError):
        Color.from_letter("e")


# ── Neighbours ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("size", [9, 13, 19])
def test_centre_point_has_four_neighbors(size: int) -> None:
    board = Board(size)
    centre = Point(size // 2, size // 2)
    assert len(board.neighbors(centre)) == 4
    assert set(board.neighbors(centre)) == {
        Point(centre.row - 1, centre.col),
        Point(centre.row + 1, centre.col),
        Point(centre.row, centre.col - 1),
        Point(centre.row, centre.col + 1),
    }


@pytest.mark.parametrize("size", [9, 13, 19])
def test_edge_point_has_three_neighbors(size: int) -> None:
    board = Board(size)
    for edge in (
        Point(0, size // 2),  # bottom
        Point(size - 1, size // 2),  # top
        Point(size // 2, 0),  # left
        Point(size // 2, size - 1),  # right
    ):
        assert len(board.neighbors(edge)) == 3, edge


@pytest.mark.parametrize("size", [9, 13, 19])
def test_corner_point_has_two_neighbors(size: int) -> None:
    board = Board(size)
    for corner in (
        Point(0, 0),
        Point(0, size - 1),
        Point(size - 1, 0),
        Point(size - 1, size - 1),
    ):
        assert len(board.neighbors(corner)) == 2, corner


def test_neighbors_excludes_diagonals() -> None:
    board = Board(9)
    assert Point(5, 5) not in board.neighbors(Point(4, 4))


def test_neighbors_rejects_a_point_off_the_board() -> None:
    with pytest.raises(OffBoardPointError):
        Board(9).neighbors(Point(9, 0))
    with pytest.raises(OffBoardPointError):
        Board(9).neighbors(Point(0, -1))


# ── Chains ────────────────────────────────────────────────────────────────────


def test_single_stone_is_its_own_chain() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . X . .
        . . . . .
        . . . . .
        """
    )
    chain = board.chain_at(Point(2, 2))
    assert chain.color is Color.BLACK
    assert chain.points == frozenset({Point(2, 2)})
    assert len(chain) == 1


def test_straight_chain_is_connected() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X X X .
        . . . . .
        . . . . .
        """
    )
    expected = {Point(2, 1), Point(2, 2), Point(2, 3)}
    for point in expected:
        assert board.chain_at(point).points == frozenset(expected)


def test_l_shaped_chain_is_connected() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . X . . .
        . X . . .
        . X X . .
        . . . . .
        """
    )
    expected = {Point(3, 1), Point(2, 1), Point(1, 1), Point(1, 2)}
    assert board.chain_at(Point(3, 1)).points == frozenset(expected)
    assert board.chain_at(Point(1, 2)).points == frozenset(expected)


def test_diagonally_adjacent_stones_are_two_chains() -> None:
    """Diagonals do not connect. This is the classic cut/connect distinction."""
    board = board_from_ascii(
        """
        . . . . .
        . X . . .
        . . X . .
        . . . . .
        . . . . .
        """
    )
    upper = board.chain_at(Point(3, 1))
    lower = board.chain_at(Point(2, 2))
    assert upper.points == frozenset({Point(3, 1)})
    assert lower.points == frozenset({Point(2, 2)})
    assert upper != lower


def test_chains_lists_each_chain_once() -> None:
    board = board_from_ascii(
        """
        X X . . O
        . . . . O
        . . X . .
        . . . . .
        O . . . .
        """
    )
    chains = board.chains()
    assert len(chains) == 4
    assert sorted(len(chain) for chain in chains) == [1, 1, 2, 2]


def test_chain_at_rejects_an_empty_point() -> None:
    with pytest.raises(EmptyPointError):
        Board(9).chain_at(Point(4, 4))


# ── Liberties ─────────────────────────────────────────────────────────────────


def test_lone_stone_in_the_centre_has_four_liberties() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . X . .
        . . . . .
        . . . . .
        """
    )
    assert board.liberty_count(Point(2, 2)) == 4


def test_corner_stone_has_two_liberties() -> None:
    board = board_from_ascii(
        """
        . . .
        . . .
        X . .
        """
    )
    assert board.liberty_count(Point(0, 0)) == 2


def test_shared_liberties_are_counted_once() -> None:
    """Two stones in a row share no liberty, but a bent three shares two.

    The point above the corner of the bend is adjacent to two stones of the same
    chain and must contribute a single liberty, not two.
    """
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X X . .
        . X . . .
        . . . . .
        """
    )
    chain = board.chain_at(Point(2, 1))
    liberties = board.liberties(chain)
    assert len(chain) == 3
    # Naively summing per-stone liberties would give 3 + 3 + 3 = 9.
    assert len(liberties) == 7
    assert Point(2, 2) not in liberties  # occupied by the chain itself


def test_fully_surrounded_chain_has_no_liberties() -> None:
    board = board_from_ascii(
        """
        . O O . .
        O X X O .
        . O O . .
        . . . . .
        . . . . .
        """
    )
    chain = board.chain_at(Point(3, 1))
    assert len(chain) == 2
    assert board.liberties(chain) == frozenset()


def test_liberties_rejects_a_chain_from_a_different_position() -> None:
    stale = Chain(color=Color.BLACK, points=frozenset({Point(4, 4)}))
    with pytest.raises(EmptyPointError):
        Board(9).liberties(stale)


# ── Captures ──────────────────────────────────────────────────────────────────


def test_capturing_a_single_stone() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O X . .
        . . O . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(Point(2, 3))
    assert result.captured == frozenset({Point(2, 2)})
    assert result.capture_count == 1
    assert result.is_capture
    assert result.board.get(Point(2, 2)) is None


def test_capturing_a_multi_stone_chain() -> None:
    board = board_from_ascii(
        """
        . O O . .
        O X X . .
        . O O . .
        . . . . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(Point(3, 3))
    assert result.captured == frozenset({Point(3, 1), Point(3, 2)})
    assert result.board.get(Point(3, 1)) is None
    assert result.board.get(Point(3, 2)) is None
    assert len(result.captured_chains) == 1
    assert result.captured_chains[0].color is Color.BLACK


def test_one_move_captures_two_separate_chains() -> None:
    """The played stone is the last liberty of two distinct enemy chains at once.

    Both must go, and they must be reported as two chains rather than one blob.
    """
    board = board_from_ascii(
        """
        . . O . .
        . O X O .
        O . . . O
        . O X O .
        . . O . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(Point(2, 2))
    assert result.captured == frozenset({Point(3, 2), Point(1, 2)})
    assert len(result.captured_chains) == 2
    assert {len(chain) for chain in result.captured_chains} == {1}


def test_capture_opens_a_liberty_for_the_played_stone() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O X . .
        . . O . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(Point(2, 3))
    # The captured point is now one of the played stone's own liberties.
    assert result.liberties_after is not None
    assert Point(2, 2) in result.liberties_after


def test_captures_are_reported_without_diffing_the_boards() -> None:
    board = board_from_ascii(
        """
        . . . .
        . O . .
        O X O .
        . . . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(Point(0, 1))
    assert result.color is Color.WHITE
    assert result.move == Point(0, 1)
    assert result.captured == frozenset({Point(1, 1)})
    assert result.chain_after == Chain(color=Color.WHITE, points=frozenset({Point(0, 1)}))


# ── Capture ordering ──────────────────────────────────────────────────────────


def test_move_that_would_be_suicide_except_it_captures_first() -> None:
    """The single most common source of board bugs.

    White plays into a point with no liberties of its own. Because the black chain
    it fills the last liberty of is removed *before* white's own liberties are
    judged, the move is legal.
    """
    board = board_from_ascii(
        """
        . X O . .
        X X O . .
        O O . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    played = Point(4, 0)  # top-left corner
    # Both of the corner's neighbours are black, so a lone white stone there has no
    # liberty of its own and joins no friendly chain.
    assert board.get(played) is None
    assert all(board.get(point) is Color.BLACK for point in board.neighbors(played))

    result = board.place_move(played)

    # The black chain had exactly one liberty — the played point — and is gone.
    assert result.captured == frozenset({Point(4, 1), Point(3, 0), Point(3, 1)})
    # White's stone survives, on liberties freed by the capture.
    assert result.board.get(played) is Color.WHITE
    assert result.liberties_after == frozenset({Point(4, 1), Point(3, 0)})


def test_filling_the_last_liberty_is_suicide_when_nothing_is_captured() -> None:
    """The same shape, with one white stone removed.

    Black now has an outside liberty at (2, 0), so nothing is captured and the
    played stone has nowhere to breathe.
    """
    board = board_from_ascii(
        """
        . X O . .
        X X O . .
        . O . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    assert board.liberty_count(Point(4, 1)) == 2
    with pytest.raises(SuicideError):
        board.place_move(Point(4, 0))


# ── Suicide vs. self-atari ────────────────────────────────────────────────────


def test_single_stone_suicide_raises() -> None:
    board = board_from_ascii(
        """
        . O . . .
        O . O . .
        . O . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.BLACK,
    )
    with pytest.raises(SuicideError):
        board.place_move(Point(3, 1))


def test_filling_your_own_last_outside_liberty_raises() -> None:
    """Black fills the single liberty of its own surrounded chain."""
    board = board_from_ascii(
        """
        . O O . .
        O X X O .
        O X . O .
        . O O . .
        . . . . .
        """,
        to_play=Color.BLACK,
    )
    # The black chain is already in atari, with its one liberty at (2, 2).
    assert board.liberties(board.chain_at(Point(3, 1))) == frozenset({Point(2, 2)})
    with pytest.raises(SuicideError):
        board.place_move(Point(2, 2))


def test_self_atari_is_legal_and_observable() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O . . .
        . . O . .
        . . . . .
        """,
        to_play=Color.BLACK,
    )
    result = board.place_move(Point(2, 2))
    assert result.is_self_atari
    assert result.liberty_count == 1
    assert result.liberties_after == frozenset({Point(2, 3)})
    assert result.board.get(Point(2, 2)) is Color.BLACK


def test_a_comfortable_move_is_not_self_atari() -> None:
    result = Board(9).place_move(Point(4, 4))
    assert not result.is_self_atari
    assert result.liberty_count == 4


def test_playing_on_an_occupied_point_raises() -> None:
    board = board_from_ascii(
        """
        . . .
        . X .
        . . .
        """,
        to_play=Color.WHITE,
    )
    with pytest.raises(OccupiedPointError):
        board.place_move(Point(1, 1))


# ── Ko ────────────────────────────────────────────────────────────────────────


def _ko_position() -> Board:
    """A standard ko shape, with black to play the capture at (2, 2).

    . . . . .
    . X O . .
    X . X O .      <- black plays here, taking the white stone at (2, 3)
    . X O . .
    . . . . .
    """
    return board_from_ascii(
        """
        . . . . .
        . X O . .
        X O . O .
        . X O . .
        . . . . .
        """,
        to_play=Color.BLACK,
    )


def test_capture_creates_a_ko_ban() -> None:
    result = _ko_position().place_move(Point(2, 2))
    assert result.captured == frozenset({Point(2, 1)})
    assert result.ko_point == Point(2, 1)
    assert result.board.ko_point == Point(2, 1)


def test_immediate_recapture_is_rejected() -> None:
    after_capture = _ko_position().place_move(Point(2, 2)).board
    assert after_capture.to_play is Color.WHITE
    with pytest.raises(KoError):
        after_capture.place_move(Point(2, 1))


def test_recapture_is_legal_after_a_move_elsewhere() -> None:
    after_capture = _ko_position().place_move(Point(2, 2)).board
    after_threat = after_capture.place_move(Point(0, 4)).board  # white plays away
    assert after_threat.ko_point is None
    after_answer = after_threat.place_move(Point(0, 3)).board  # black answers
    recapture = after_answer.place_move(Point(2, 1))
    assert recapture.captured == frozenset({Point(2, 2)})


def test_a_pass_clears_the_ko_ban() -> None:
    after_capture = _ko_position().place_move(Point(2, 2)).board
    after_pass = after_capture.place_move(PASS).board
    assert after_pass.ko_point is None


def test_a_multi_stone_capture_is_not_a_ko() -> None:
    """Only a one-for-one capture can recreate the previous position."""
    board = board_from_ascii(
        """
        . O O . .
        O X X . .
        . O O . .
        . . . . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(Point(3, 3))
    assert result.capture_count == 2
    assert result.ko_point is None


def test_position_key_ignores_ko_and_turn() -> None:
    """Superko will be layered on top of this, so it must key on stones alone."""
    board = Board(9)
    assert board.position_key() == board.with_to_play(Color.WHITE).position_key()


# ── Passes ────────────────────────────────────────────────────────────────────


def test_pass_leaves_the_position_untouched() -> None:
    board = board_from_ascii(
        """
        . . .
        . X .
        . . .
        """,
        to_play=Color.WHITE,
    )
    result = board.place_move(PASS)
    assert result.is_pass
    assert result.board.position_key() == board.position_key()
    assert result.captured == frozenset()
    assert result.chain_after is None
    assert result.liberties_after is None
    assert result.liberty_count is None
    assert not result.is_self_atari


def test_pass_alternates_the_turn() -> None:
    board = Board(9)
    assert board.to_play is Color.BLACK
    assert board.place_move(PASS).board.to_play is Color.WHITE


def test_two_passes_return_the_turn() -> None:
    board = Board(9).place_move(PASS).board.place_move(PASS).board
    assert board.to_play is Color.BLACK


# ── Setup stones ──────────────────────────────────────────────────────────────


def test_setup_stones_do_not_resolve_captures() -> None:
    """A diagram may contain a chain with no liberties; setup must not remove it."""
    board = Board(5).place_setup_stones(
        black=[Point(2, 2)],
        white=[Point(2, 1), Point(2, 3), Point(1, 2), Point(3, 2)],
    )
    assert board.get(Point(2, 2)) is Color.BLACK
    assert board.liberty_count(Point(2, 2)) == 0


def test_setup_stones_do_not_alternate_the_turn() -> None:
    board = Board(19).place_setup_stones(black=[Point(3, 3), Point(15, 15)])
    assert board.to_play is Color.BLACK
    assert board.with_to_play(Color.WHITE).to_play is Color.WHITE


def test_setup_stones_clear_the_ko_ban() -> None:
    after_capture = _ko_position().place_move(Point(2, 2)).board
    assert after_capture.ko_point is not None
    assert after_capture.place_setup_stones(black=[Point(0, 0)]).ko_point is None


def test_setup_stones_overwrite_and_can_remove() -> None:
    board = Board(5).place_setup_stones(black=[Point(1, 1)])
    overwritten = board.place_setup_stones(white=[Point(1, 1)])
    cleared = overwritten.place_setup_stones(empty=[Point(1, 1)])
    assert overwritten.get(Point(1, 1)) is Color.WHITE
    assert cleared.get(Point(1, 1)) is None


def test_setup_stones_reject_a_conflicting_assignment() -> None:
    with pytest.raises(SetupConflictError):
        Board(9).place_setup_stones(black=[Point(1, 1)], white=[Point(1, 1)])


def test_setup_stones_reject_a_point_off_the_board() -> None:
    with pytest.raises(OffBoardPointError):
        Board(9).place_setup_stones(black=[Point(9, 9)])


# ── Immutability ──────────────────────────────────────────────────────────────


def test_place_move_does_not_mutate_the_original_board() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O X . .
        . . O . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    before = board.to_ascii()
    before_key = board.position_key()

    result = board.place_move(Point(2, 3))

    assert board.to_ascii() == before
    assert board.position_key() == before_key
    assert board.get(Point(2, 2)) is Color.BLACK  # still captured only on the new board
    assert board.to_play is Color.WHITE
    assert result.board is not board


def test_setup_does_not_mutate_the_original_board() -> None:
    board = Board(9)
    board.place_setup_stones(black=[Point(4, 4)])
    assert board.get(Point(4, 4)) is None


def test_a_rejected_move_leaves_no_trace() -> None:
    board = board_from_ascii(
        """
        . O . . .
        O . O . .
        . O . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.BLACK,
    )
    before = board.to_ascii()
    with pytest.raises(SuicideError):
        board.place_move(Point(3, 1))
    assert board.to_ascii() == before


def test_chain_is_hashable() -> None:
    chain = Board(9).place_move(Point(4, 4)).board.chain_at(Point(4, 4))
    assert {chain, chain} == {chain}


# ── Coordinates: SGF ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("coord", "expected"),
    [
        ("aa", Point(18, 0)),  # SGF origin is the TOP-left
        ("as", Point(0, 0)),  # bottom-left
        ("sa", Point(18, 18)),  # top-right
        ("ss", Point(0, 18)),  # bottom-right
        ("dd", Point(15, 3)),  # the usual 4-4 in the upper left
        ("ii", Point(10, 8)),  # SGF does NOT skip "i"
    ],
)
def test_sgf_to_point(coord: str, expected: Point) -> None:
    assert point_from_sgf(coord, 19) == expected


def test_sgf_inverts_the_row() -> None:
    """``a`` is the top row in SGF and the highest internal row index."""
    assert point_from_sgf("aa", 19).row == 18
    assert point_from_sgf("as", 19).row == 0
    assert point_from_sgf("aa", 9).row == 8


@pytest.mark.parametrize("coord", ["aa", "as", "sa", "ss", "dd", "ii", "pd"])
def test_sgf_round_trips(coord: str) -> None:
    assert point_to_sgf(point_from_sgf(coord, 19), 19) == coord


@pytest.mark.parametrize("size", [9, 13, 19])
def test_sgf_round_trips_over_the_whole_board(size: int) -> None:
    for point in Board(size).points():
        assert point_from_sgf(point_to_sgf(point, size), size) == point


@pytest.mark.parametrize("coord", ["", "a", "aaa", "AA", "a1", "1a", "!!", "a "])
def test_malformed_sgf_raises(coord: str) -> None:
    with pytest.raises(InvalidCoordinateError):
        point_from_sgf(coord, 19)


def test_out_of_range_sgf_raises() -> None:
    """``j`` is the 10th letter, off a 9x9 board."""
    with pytest.raises(InvalidCoordinateError):
        point_from_sgf("jj", 9)
    with pytest.raises(InvalidCoordinateError):
        point_from_sgf("tt", 19)


# ── Coordinates: Go / KataGo notation ─────────────────────────────────────────


@pytest.mark.parametrize(
    ("coord", "expected"),
    [
        ("A1", Point(0, 0)),  # bottom-left
        ("A19", Point(18, 0)),  # top-left
        ("T1", Point(0, 18)),  # bottom-right
        ("T19", Point(18, 18)),  # top-right
        ("D4", Point(3, 3)),
        ("Q16", Point(15, 15)),
    ],
)
def test_go_notation_to_point(coord: str, expected: Point) -> None:
    assert point_from_go_notation(coord, 19) == expected


def test_go_notation_row_1_is_at_the_bottom() -> None:
    """No row inversion on this side: row 1 is already internal row 0."""
    assert point_from_go_notation("A1", 19).row == 0
    assert point_from_go_notation("A19", 19).row == 18


def test_go_notation_skips_the_i_column() -> None:
    """H is followed by J. Getting this wrong shifts every column past H by one."""
    assert point_from_go_notation("H1", 19).col == 7
    assert point_from_go_notation("J1", 19).col == 8
    assert point_from_go_notation("K1", 19).col == 9
    with pytest.raises(InvalidCoordinateError, match="no column 'I'"):
        point_from_go_notation("I1", 19)


def test_sgf_and_go_notation_disagree_across_the_i_boundary() -> None:
    """The same internal column is ``i`` in SGF and ``J`` in Go notation.

    Routing both through one alphabet would make these agree, and every column from
    here on would be off by one.
    """
    column_eight = Point(0, 8)
    assert point_to_sgf(column_eight, 19) == "is"
    assert point_to_go_notation(column_eight, 19) == "J1"

    column_seven = Point(0, 7)
    assert point_to_sgf(column_seven, 19) == "hs"
    assert point_to_go_notation(column_seven, 19) == "H1"


def test_sgf_to_go_notation_round_trip_across_the_i_boundary() -> None:
    for sgf_coord, go_coord in [("hd", "H16"), ("id", "J16"), ("jd", "K16")]:
        point = point_from_sgf(sgf_coord, 19)
        assert point_to_go_notation(point, 19) == go_coord
        assert point_to_sgf(point_from_go_notation(go_coord, 19), 19) == sgf_coord


@pytest.mark.parametrize("size", [9, 13, 19])
def test_go_notation_round_trips_over_the_whole_board(size: int) -> None:
    for point in Board(size).points():
        assert point_from_go_notation(point_to_go_notation(point, size), size) == point


def test_go_notation_accepts_lowercase_and_surrounding_space() -> None:
    assert point_from_go_notation(" q16 ", 19) == point_from_go_notation("Q16", 19)


@pytest.mark.parametrize("coord", ["", "Q", "16", "QQ", "Q1a", "Q-1", "?4"])
def test_malformed_go_notation_raises(coord: str) -> None:
    with pytest.raises(InvalidCoordinateError):
        point_from_go_notation(coord, 19)


@pytest.mark.parametrize("coord", ["A0", "A20", "U1", "T10"])
def test_out_of_range_go_notation_raises(coord: str) -> None:
    """``T10`` is on a 19x19 board but off a 9x9 one."""
    size = 9 if coord == "T10" else 19
    with pytest.raises(InvalidCoordinateError):
        point_from_go_notation(coord, size)


def test_conversions_reject_a_point_off_the_board() -> None:
    with pytest.raises(OffBoardPointError):
        point_to_sgf(Point(19, 0), 19)
    with pytest.raises(OffBoardPointError):
        point_to_go_notation(Point(0, 19), 19)


@pytest.mark.parametrize("size", [0, -1, MAX_BOARD_SIZE + 1])
def test_conversions_reject_an_impossible_board_size(size: int) -> None:
    with pytest.raises(InvalidCoordinateError):
        point_from_sgf("aa", size)


def test_board_rejects_an_impossible_size() -> None:
    with pytest.raises(InvalidCoordinateError):
        Board(0)
    with pytest.raises(InvalidCoordinateError):
        Board(MAX_BOARD_SIZE + 1)


# ── Coordinates: passes ───────────────────────────────────────────────────────


def test_sgf_pass_encodings() -> None:
    assert move_from_sgf("", 19) is PASS
    assert move_from_sgf("tt", 19) is PASS  # FF[3]-era pass
    assert move_to_sgf(PASS, 19) == ""


def test_tt_is_a_real_point_on_a_board_larger_than_19() -> None:
    assert move_from_sgf("tt", 21) == Point(1, 19)


def test_go_notation_pass() -> None:
    assert move_from_go_notation("pass", 19) is PASS
    assert move_from_go_notation("PASS", 19) is PASS
    assert move_to_go_notation(PASS, 19) == "pass"


def test_move_converters_still_handle_real_points() -> None:
    assert move_from_sgf("dd", 19) == Point(15, 3)
    assert move_to_sgf(Point(15, 3), 19) == "dd"
    assert move_from_go_notation("Q16", 19) == Point(15, 15)
    assert move_to_go_notation(Point(15, 15), 19) == "Q16"


# ── Board sizes ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("size", [9, 13, 19])
def test_capture_works_on_every_supported_size(size: int) -> None:
    board = Board(size).with_to_play(Color.WHITE)
    corner = Point(0, 0)
    board = board.place_setup_stones(black=[corner], white=[Point(0, 1)])
    result = board.place_move(Point(1, 0))
    assert result.captured == frozenset({corner})
    assert result.board.size == size
