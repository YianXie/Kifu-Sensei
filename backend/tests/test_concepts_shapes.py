"""The shape and tactical (Tier 3) detectors in ``app.services.concepts``.

Back to exact, board-derived computation — none of Tier 2's estimate hazards apply.
The characteristic failure here is orientation: a shape detector that quietly only
matches two of its eight symmetries looks correct in every hand-written test until a
real game rotates it. So every shape is tested under all four rotations and both
reflections, driven by :func:`oriented`, which transforms the whole position rather
than restating it eight times.

The other hazard is over-firing. Shapes and stone relationships occur constantly,
and the block is capped at eight lines, so the suppression table and the salience
floor on relationships are tested as carefully as the detectors themselves.
"""

from collections.abc import Callable
from typing import Any

import pytest
from board_fixtures import board_from_ascii

from app.services.board import PASS, Board, Color, Move, Point
from app.services.concepts import (
    DETECTORS,
    SUPPRESSIONS,
    Finding,
    Salience,
    _ladder_line,
    context_for_move,
    detect_bamboo_joint,
    detect_cut,
    detect_empty_triangle,
    detect_extension,
    detect_hane,
    detect_ladder,
    detect_ponnuki,
    detect_stone_relationship,
    detect_tigers_mouth,
    render_detected_features,
    run_detectors,
)

# ── Orientation harness ───────────────────────────────────────────────────────


#: The dihedral group of the square, as maps on *diagram* coordinates (row 0 at the
#: top). Built by composing one rotation and one reflection rather than written out,
#: so the harness itself cannot quietly omit an orientation.
def _rot90(row: int, col: int, n: int) -> tuple[int, int]:
    return col, n - 1 - row


def _mirror(row: int, col: int, n: int) -> tuple[int, int]:
    return row, n - 1 - col


def _compose(*maps: Callable[[int, int, int], tuple[int, int]]):
    def applied(row: int, col: int, n: int) -> tuple[int, int]:
        for step in maps:
            row, col = step(row, col, n)
        return row, col

    return applied


_IDENTITY = _compose()
_ROT180 = _compose(_rot90, _rot90)
_ROT270 = _compose(_rot90, _rot90, _rot90)

ORIENTATIONS: dict[str, Callable[[int, int, int], tuple[int, int]]] = {
    "identity": _IDENTITY,
    "rot90": _rot90,
    "rot180": _ROT180,
    "rot270": _ROT270,
    "mirror": _mirror,
    "mirror+rot90": _compose(_mirror, _rot90),
    "mirror+rot180": _compose(_mirror, _ROT180),
    "mirror+rot270": _compose(_mirror, _ROT270),
}


def oriented(
    diagram: str, played: tuple[int, int], orientation: str, *, to_play: Color = Color.BLACK
) -> tuple[Board, Point]:
    """Transform a whole position by one of the eight symmetries.

    ``played`` is given in diagram coordinates (row 0 at the top), matching the
    diagram itself, and comes back as a board :class:`Point`.
    """
    rows = [line.replace(" ", "") for line in diagram.strip().splitlines()]
    rows = [row for row in rows if row]
    size = len(rows)
    transform = ORIENTATIONS[orientation]

    grid = [["."] * size for _ in range(size)]
    for row in range(size):
        for col in range(size):
            new_row, new_col = transform(row, col, size)
            grid[new_row][new_col] = rows[row][col]
    board = board_from_ascii("\n".join("".join(row) for row in grid), to_play=to_play)

    played_row, played_col = transform(played[0], played[1], size)
    return board, Point(size - 1 - played_row, played_col)


def _ctx(board: Board, move: Move, **kwargs: Any):
    kwargs.setdefault("move_number", 50)
    return context_for_move(board, move, **kwargs)


def test_the_orientation_harness_really_moves_the_position() -> None:
    """Guard the guard: if every orientation returned the same board, the symmetry
    tests below would all pass without proving anything."""
    diagram = """
    X . .
    . . .
    . . .
    """
    boards = {oriented(diagram, (2, 2), name)[0].to_ascii() for name in ORIENTATIONS}
    assert len(boards) == 4  # a lone corner stone has a four-element orbit


# ── Stone relationships ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("stone", "played", "expected"),
    [
        ((2, 2), (2, 4), "tobi"),
        ((2, 2), (2, 5), "nikken tobi"),
        ((2, 2), (3, 3), "kosumi"),
        ((2, 2), (3, 4), "keima"),
        ((2, 2), (3, 5), "ogeima"),
    ],
)
def test_each_named_relationship(
    stone: tuple[int, int], played: tuple[int, int], expected: str
) -> None:
    rows = [["."] * 7 for _ in range(7)]
    rows[stone[0]][stone[1]] = "X"
    board = board_from_ascii("\n".join("".join(row) for row in rows))
    finding = detect_stone_relationship(_ctx(board, Point(6 - played[0], played[1])))
    assert finding is not None
    assert expected in finding.detail
    assert finding.points == (Point(6 - stone[0], stone[1]),)
    assert finding.salience is Salience.BACKGROUND


@pytest.mark.parametrize("orientation", list(ORIENTATIONS))
def test_keima_is_found_in_every_orientation(orientation: str) -> None:
    diagram = """
    . . . . . . .
    . . . . . . .
    . . X . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . . . . . . .
    """
    board, played = oriented(diagram, (3, 4), orientation)
    finding = detect_stone_relationship(_ctx(board, played))
    assert finding is not None
    assert "keima" in finding.detail


def test_relationship_is_silent_when_no_friendly_stone_is_in_range() -> None:
    """An isolated move in an empty corner has no relationship, and that is fine."""
    assert detect_stone_relationship(_ctx(Board(19), Point(3, 3))) is None


def test_relationship_is_silent_when_the_nearest_friend_is_too_far() -> None:
    board = board_from_ascii(
        "\n".join(["X" + "." * 8] + ["." * 9] * 8)
    )  # stone at the top-left corner
    assert detect_stone_relationship(_ctx(board, Point(0, 8))) is None


@pytest.mark.parametrize(("intruder", "played"), [((2, 3), (2, 4)), ((3, 3), (3, 4))])
def test_relationship_requires_a_clean_connecting_path(
    intruder: tuple[int, int], played: tuple[int, int]
) -> None:
    """A keima with an enemy stone in the gap is not meaningfully a keima."""
    rows = [["."] * 7 for _ in range(7)]
    rows[2][2] = "X"
    rows[intruder[0]][intruder[1]] = "O"
    board = board_from_ascii("\n".join("".join(row) for row in rows))
    assert detect_stone_relationship(_ctx(board, Point(6 - played[0], played[1]))) is None


def test_ogeima_with_a_stone_in_the_box_does_not_fire() -> None:
    rows = [["."] * 7 for _ in range(7)]
    rows[2][2] = "X"
    rows[2][4] = "O"
    board = board_from_ascii("\n".join("".join(row) for row in rows))
    assert detect_stone_relationship(_ctx(board, Point(6 - 3, 5))) is None


def test_relationship_tie_break_takes_the_nearest_stone() -> None:
    """Simultaneously a tobi to one stone and a keima to another.

    The rule is nearest-by-Euclidean-distance, so the tobi at 2.0 beats the keima at
    2.24, and exactly one relationship is reported.
    """
    diagram = """
    . . . . .
    . . . . .
    . . . . X
    . . . . .
    . X . . .
    """
    board = board_from_ascii(diagram)
    played = Point(2, 2)
    finding = detect_stone_relationship(_ctx(board, played))
    assert finding is not None
    assert "tobi" in finding.detail
    assert "keima" not in finding.detail
    assert finding.points == (Point(2, 4),)


def test_relationship_and_extension_cannot_both_fire() -> None:
    """Structurally exclusive, which is why the suppression table has no entry.

    An adjacent stone sits at distance 1 and always wins the nearest-stone contest,
    and a plain adjacency has no name in the relationship table.
    """
    diagram = """
    . . . . .
    . . . . .
    . X . X .
    . . . . .
    . . . . .
    """
    context = _ctx(board_from_ascii(diagram), Point(2, 2))
    assert detect_extension(context) is not None
    assert detect_stone_relationship(context) is None


def test_relationship_is_silent_on_a_pass() -> None:
    assert detect_stone_relationship(_ctx(Board(19), PASS)) is None


# ── Hane ──────────────────────────────────────────────────────────────────────

_HANE = """
. . . . .
. X O . .
. . . . .
. . . . .
. . . . .
"""


@pytest.mark.parametrize("orientation", list(ORIENTATIONS))
def test_hane_in_every_orientation(orientation: str) -> None:
    board, played = oriented(_HANE, (2, 1), orientation)
    finding = detect_hane(_ctx(board, played))
    assert finding is not None
    assert finding.salience is Salience.NOTABLE


def test_hane_reports_the_friendly_and_enemy_stones() -> None:
    board, played = oriented(_HANE, (2, 1), "identity")
    finding = detect_hane(_ctx(board, played))
    assert finding is not None
    assert set(finding.points) == {Point(3, 1), Point(3, 2)}


def test_hane_is_silent_without_an_enemy_stone_diagonally() -> None:
    diagram = """
    . . . . .
    . X . . .
    . . . . .
    . . . . .
    . . . . .
    """
    assert detect_hane(_ctx(board_from_ascii(diagram), Point(2, 1))) is None


def test_hane_is_silent_when_the_friendly_stone_does_not_touch_the_enemy() -> None:
    diagram = """
    . . . . .
    . . O . .
    . . . . .
    . X . . .
    . . . . .
    """
    # The black stone at (1, 1) is nowhere near the white stone it would have to touch.
    assert detect_hane(_ctx(board_from_ascii(diagram), Point(2, 1))) is None


def test_hane_suppresses_the_contact_play_line() -> None:
    """A hane is a contact play by definition; saying both wastes a capped line."""
    board, played = oriented(_HANE, (2, 1), "identity")
    concepts = [finding.concept for finding in run_detectors(_ctx(board, played))]
    assert "hane" in concepts
    assert "contact_play" not in concepts


# ── Empty triangle ────────────────────────────────────────────────────────────

_EMPTY_TRIANGLE = """
. . . . .
. X X . .
. . . . .
. . . . .
. . . . .
"""


@pytest.mark.parametrize("orientation", list(ORIENTATIONS))
def test_empty_triangle_in_every_orientation(orientation: str) -> None:
    board, played = oriented(_EMPTY_TRIANGLE, (2, 1), orientation)
    finding = detect_empty_triangle(_ctx(board, played))
    assert finding is not None
    assert len(finding.points) == 3


def test_empty_triangle_reports_its_stones_and_the_empty_point() -> None:
    board, played = oriented(_EMPTY_TRIANGLE, (2, 1), "identity")
    finding = detect_empty_triangle(_ctx(board, played))
    assert finding is not None
    assert set(finding.points) == {Point(3, 1), Point(3, 2), Point(2, 1)}
    assert "C3" in finding.detail  # the empty fourth point, Point(2, 2)


def test_an_enemy_stone_on_the_fourth_point_is_not_an_empty_triangle() -> None:
    """The most common false positive: the point must be empty, not merely
    not-friendly."""
    diagram = """
    . . . . .
    . X X . .
    . . O . .
    . . . . .
    . . . . .
    """
    assert detect_empty_triangle(_ctx(board_from_ascii(diagram), Point(2, 1))) is None


def test_a_friendly_stone_on_the_fourth_point_is_not_an_empty_triangle() -> None:
    diagram = """
    . . . . .
    . X X . .
    . . X . .
    . . . . .
    . . . . .
    """
    assert detect_empty_triangle(_ctx(board_from_ascii(diagram), Point(2, 1))) is None


def test_empty_triangle_is_reported_on_the_first_line() -> None:
    """Reported deliberately. The same three stones are often correct on the edge,
    but that judgement needs the surrounding position, which this layer lacks —
    Tier 1's line-number finding gives the model what it needs to make it."""
    diagram = """
    . . . . .
    . . . . .
    . . . . .
    . X X . .
    . . . . .
    """
    finding = detect_empty_triangle(_ctx(board_from_ascii(diagram), Point(0, 1)))
    assert finding is not None


def test_empty_triangle_in_the_corner() -> None:
    diagram = """
    . . . . .
    . . . . .
    . . . . .
    X . . . .
    X . . . .
    """
    finding = detect_empty_triangle(_ctx(board_from_ascii(diagram), Point(0, 1)))
    assert finding is not None
    assert set(finding.points) == {Point(1, 0), Point(0, 0), Point(0, 1)}


# ── Tiger's mouth ─────────────────────────────────────────────────────────────

_TIGERS_MOUTH = """
. . . . .
. . X . .
. X . . .
. . . . .
. . . . .
"""


@pytest.mark.parametrize("orientation", list(ORIENTATIONS))
def test_tigers_mouth_in_every_orientation(orientation: str) -> None:
    board, played = oriented(_TIGERS_MOUTH, (2, 3), orientation)
    finding = detect_tigers_mouth(_ctx(board, played))
    assert finding is not None


def test_tigers_mouth_reports_the_gap_point() -> None:
    board, played = oriented(_TIGERS_MOUTH, (2, 3), "identity")
    finding = detect_tigers_mouth(_ctx(board, played))
    assert finding is not None
    assert finding.points == (Point(2, 2),)


def test_tigers_mouth_discloses_a_second_one_formed_by_the_same_move() -> None:
    """One finding per concept, so extra instances are counted rather than dropped —
    silently reporting one of two would understate a block sold as fact."""
    diagram = """
    . . . . . . .
    . . . . . . .
    . . . . . . .
    . X . . . X .
    . . X . X . .
    . . . . . . .
    . . . . . . .
    """
    finding = detect_tigers_mouth(_ctx(board_from_ascii(diagram), Point(3, 3)))
    assert finding is not None
    assert "more formed by the same move" in finding.detail


def test_tigers_mouth_is_silent_with_only_two_flanking_stones() -> None:
    diagram = """
    . . . . .
    . . X . .
    . . . . .
    . . . . .
    . . . . .
    """
    assert detect_tigers_mouth(_ctx(board_from_ascii(diagram), Point(2, 1))) is None


def test_tigers_mouth_is_silent_when_an_enemy_plugs_the_fourth_side() -> None:
    diagram = """
    . . . . .
    . . X . .
    . X . . .
    . . O . .
    . . . . .
    """
    assert detect_tigers_mouth(_ctx(board_from_ascii(diagram), Point(2, 3))) is None


def test_tigers_mouth_is_not_reported_on_the_board_edge() -> None:
    """With three neighbours rather than four, three friendly stones make an eye,
    not a mouth."""
    diagram = """
    . . . . .
    . . . . .
    . . . . .
    . . X . .
    . X . . .
    """
    assert detect_tigers_mouth(_ctx(board_from_ascii(diagram), Point(0, 3))) is None


# ── Bamboo joint ──────────────────────────────────────────────────────────────

_BAMBOO = """
. . . . .
. X X . .
. . . . .
. X . . .
. . . . .
"""


@pytest.mark.parametrize("orientation", list(ORIENTATIONS))
def test_bamboo_joint_in_every_orientation(orientation: str) -> None:
    board, played = oriented(_BAMBOO, (3, 2), orientation)
    finding = detect_bamboo_joint(_ctx(board, played))
    assert finding is not None
    assert len(finding.points) == 4


def test_bamboo_joint_is_silent_when_the_gap_is_not_empty() -> None:
    diagram = """
    . . . . .
    . X X . .
    . . O . .
    . X . . .
    . . . . .
    """
    assert detect_bamboo_joint(_ctx(board_from_ascii(diagram), Point(1, 2))) is None


def test_bamboo_joint_is_silent_with_only_three_stones() -> None:
    diagram = """
    . . . . .
    . X X . .
    . . . . .
    . . . . .
    . . . . .
    """
    assert detect_bamboo_joint(_ctx(board_from_ascii(diagram), Point(1, 1))) is None


# ── Ponnuki ───────────────────────────────────────────────────────────────────

_PONNUKI = """
. . . . .
. . X . .
. X O . .
. . X . .
. . . . .
"""


@pytest.mark.parametrize("orientation", list(ORIENTATIONS))
def test_ponnuki_in_every_orientation(orientation: str) -> None:
    board, played = oriented(_PONNUKI, (2, 3), orientation)
    finding = detect_ponnuki(_ctx(board, played))
    assert finding is not None
    assert len(finding.points) == 4


def test_ponnuki_reports_the_diamond() -> None:
    board, played = oriented(_PONNUKI, (2, 3), "identity")
    finding = detect_ponnuki(_ctx(board, played))
    assert finding is not None
    assert set(finding.points) == {Point(3, 2), Point(1, 2), Point(2, 1), Point(2, 3)}


def test_a_diamond_around_an_always_empty_point_is_not_a_ponnuki() -> None:
    """The capture is what makes it a ponnuki."""
    diagram = """
    . . . . .
    . . X . .
    . X . . .
    . . X . .
    . . . . .
    """
    assert detect_ponnuki(_ctx(board_from_ascii(diagram), Point(2, 3))) is None


def test_a_multi_stone_capture_is_not_a_ponnuki() -> None:
    diagram = """
    . O O . .
    O X X . .
    . O O . .
    . . . . .
    . . . . .
    """
    context = _ctx(board_from_ascii(diagram, to_play=Color.WHITE), Point(3, 3))
    assert context.result.capture_count == 2
    assert detect_ponnuki(context) is None


def test_ponnuki_keeps_the_capture_line_alongside_it() -> None:
    """Deliberately not suppressed: the capture line carries the count and points,
    and ponnuki adds the shape. Dropping it would lose information, not a duplicate."""
    board, played = oriented(_PONNUKI, (2, 3), "identity")
    concepts = [finding.concept for finding in run_detectors(_ctx(board, played))]
    assert "ponnuki" in concepts
    assert "capture" in concepts


# ── Cut ───────────────────────────────────────────────────────────────────────


def test_cut_fires_between_two_distinct_enemy_chains() -> None:
    diagram = """
    . . . . .
    . . O . .
    . . . . .
    . . O . .
    . . . . .
    """
    finding = detect_cut(_ctx(board_from_ascii(diagram), Point(2, 2)))
    assert finding is not None
    assert set(finding.points) == {Point(3, 2), Point(1, 2)}
    assert finding.salience is Salience.CRITICAL


def test_cut_does_not_fire_on_two_points_of_one_chain() -> None:
    """The stones are adjacent to the played point but already joined behind it."""
    diagram = """
    . . . . .
    . O O . .
    . O . . .
    . . . . .
    . . . . .
    """
    assert detect_cut(_ctx(board_from_ascii(diagram), Point(2, 2))) is None


def test_cut_claims_only_separation_not_success() -> None:
    diagram = """
    . . . . .
    . . O . .
    . . . . .
    . . O . .
    . . . . .
    """
    finding = detect_cut(_ctx(board_from_ascii(diagram), Point(2, 2)))
    assert finding is not None
    for claim in ("works", "cannot", "succeeds", "captured", "dead"):
        assert claim not in finding.detail.lower()


# ── Ladder ────────────────────────────────────────────────────────────────────

# White at (7, 1) has exactly two liberties, so Black at (6, 1) puts it in atari.
# The black stone above the escape point is what makes running a two-liberty
# extension rather than a free breakout — that is what turns a chase into a ladder.
# The chase then runs diagonally toward the far corner.
_LADDER = """
. X X . . . . . .
X O . . . . . . .
. . . . . . . . .
. . . . . . . . .
. . . . . . . . .
. . . . . . . . .
. . . . . . . . .
. . . . . . . . .
. . . . . . . . .
"""

_LADDER_ATARI = Point(6, 1)
_LADDER_ANCHOR = Point(7, 1)


def test_a_working_ladder_ends_in_capture() -> None:
    finding = detect_ladder(_ctx(board_from_ascii(_LADDER), _LADDER_ATARI))
    assert finding is not None
    assert "captured" in finding.detail
    assert finding.salience is Salience.CRITICAL


def test_a_ladder_breaker_lets_the_chased_group_escape() -> None:
    """The breaker's location is the single most useful thing a ladder read gives a
    kyu player, so it is named explicitly.

    The white stone sits on the ladder's diagonal path, five moves along.
    """
    diagram = """
    . X X . . . . . .
    X O . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . O . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    """
    finding = detect_ladder(_ctx(board_from_ascii(diagram), _LADDER_ATARI))
    assert finding is not None
    assert "escapes" in finding.detail
    assert "a White stone at E5 breaking it" in finding.detail


def test_the_ladder_read_reports_unresolved_when_it_hits_the_depth_cap() -> None:
    """The read must always terminate with an explicit answer, never hang, never
    raise, and never quietly report a guess as a result."""
    after = board_from_ascii(_LADDER).place_move(_LADDER_ATARI).board
    read = _ladder_line(after, _LADDER_ANCHOR, Color.WHITE, 0, [512], 1)
    assert read.outcome == "unresolved"


def test_the_ladder_read_respects_the_node_budget() -> None:
    after = board_from_ascii(_LADDER).place_move(_LADDER_ATARI).board
    read = _ladder_line(after, _LADDER_ANCHOR, Color.WHITE, 0, [0], 100)
    assert read.outcome == "unresolved"


def test_ladder_is_silent_when_the_move_gives_no_atari() -> None:
    """Gated so a search never runs on the great majority of moves."""
    assert detect_ladder(_ctx(Board(19), Point(3, 3))) is None


def test_ladder_does_not_say_the_move_was_therefore_right() -> None:
    """A ladder that works can still be the wrong move."""
    finding = detect_ladder(_ctx(board_from_ascii(_LADDER), _LADDER_ATARI))
    assert finding is not None
    for claim in ("should", "correct", "good", "works, so", "mistake"):
        assert claim not in finding.detail.lower()


# ── Suppression map and over-firing ───────────────────────────────────────────


def test_every_suppression_names_concepts_that_exist() -> None:
    """A typo in the table would silently suppress nothing, forever."""
    known = set()
    diagram = """
    . . . . .
    . X O . .
    . . . . .
    . . . . .
    . . . . .
    """
    for detector in DETECTORS:
        finding = detector(_ctx(board_from_ascii(diagram), Point(2, 1)))
        if finding is not None:
            known.add(finding.concept)
    # Concepts needing a richer position than one diagram can hold, listed so the
    # check stays about typos in the table rather than about diagram coverage.
    known |= {
        "atari_given",
        "bamboo_joint",
        "connection",
        "contact_play",
        "double_atari",
        "hane",
        "tigers_mouth",
    }
    for winner, losers in SUPPRESSIONS.items():
        assert winner in known, winner
        for loser in losers:
            assert loser in known, loser


def test_relationships_never_outrank_a_group_in_atari() -> None:
    """The whole point of the background floor: a nearest-stone relationship must not
    push a critical finding out of a capped block."""
    diagram = """
    . . . . . . . O X
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . X . . . . . .
    . . . . . . . . .
    """
    # White has just ataried Black's corner stone; Black answers with a tobi in the
    # far corner instead.
    findings = run_detectors(
        _ctx(board_from_ascii(diagram), Point(1, 4), previous_move=Point(8, 7))
    )
    concepts = [finding.concept for finding in findings]
    assert "stone_relationship" in concepts
    assert concepts[0] == "atari_ignored"
    assert findings[0].salience is Salience.CRITICAL
    assert concepts.index("stone_relationship") > concepts.index("atari_ignored")


def test_the_block_holds_its_cap_under_a_flood_of_findings() -> None:
    findings = [
        *[
            Finding(
                concept=f"c{i}", label=f"C{i}", detail=f"critical {i}", salience=Salience.CRITICAL
            )
            for i in range(5)
        ],
        *[
            Finding(
                concept=f"n{i}", label=f"N{i}", detail=f"notable {i}", salience=Salience.NOTABLE
            )
            for i in range(5)
        ],
        *[
            Finding(
                concept=f"b{i}",
                label=f"B{i}",
                detail=f"background {i}",
                salience=Salience.BACKGROUND,
            )
            for i in range(7)
        ],
    ]
    assert len(findings) == 17
    text = render_detected_features(findings)
    body = [line for line in text.splitlines() if line.startswith("  ")]
    assert len(body) == 8
    # Every critical survived; no background did.
    for i in range(5):
        assert f"critical {i}" in text
    assert "background 0" not in text


def test_a_real_crowded_move_stays_within_the_cap() -> None:
    diagram = """
    . . . . . . . . .
    . X X . . . . . .
    . X O . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    . . . . . . . . .
    """
    context = _ctx(board_from_ascii(diagram), Point(5, 2))
    findings = run_detectors(context)
    body = [
        line for line in render_detected_features(findings).splitlines() if line.startswith("  ")
    ]
    assert len(body) <= 8
    assert len(body) == min(len(findings), 8)
