"""The KataGo-derived (Tier 2) detectors in ``app.services.concepts``.

These consume a neural-network estimate rather than stone geometry, which brings a
failure mode the board detectors do not have: a misread ownership array still yields
well-formed numbers, and the feature block tells the model it may state them as
fact. A transposed map does not crash, it lies fluently.

So orientation and perspective are pinned first and hardest, including explicit
"this test would catch it" cases built from deliberately corrupted arrays. Payloads
here are synthetic — the live engine checks live in ``test_katago_live.py``.
"""

from typing import Any

import pytest
from board_fixtures import board_from_ascii

from app.services.board import PASS, Board, Color, Move, Point
from app.services.concepts import (
    DETECTORS,
    Certainty,
    OwnershipLengthError,
    OwnershipMap,
    Salience,
    context_for_move,
    detect_direction_of_play,
    detect_group_settledness,
    detect_local_ownership_swing,
    detect_move_in_largest_area,
    detect_move_ranking,
    detect_sente_gote,
    detect_settledness_change,
    render_detected_features,
    run_detectors,
)

# Ownership symbols, mirroring the map KataGo's output is rendered as elsewhere in
# the prompt. Full-strength values keep the contested arithmetic exact: a "B" point
# contributes 0 to a contested total, a "." point contributes 1.
_OWNERSHIP_SYMBOLS = {"B": 1.0, "b": 0.5, ".": 0.0, "w": -0.5, "W": -1.0}

TIER_2_DETECTORS = (
    detect_group_settledness,
    detect_settledness_change,
    detect_direction_of_play,
    detect_move_in_largest_area,
    detect_local_ownership_swing,
    detect_sente_gote,
)


def ownership_from_ascii(diagram: str) -> list[float]:
    """Build a flat ownership array from a diagram, **first line = top row**.

    Written as a straight reading-order concatenation, which is the protocol's own
    definition of the array. It deliberately does not reuse :class:`OwnershipMap`'s
    index arithmetic, so an error in that arithmetic shows up as a test failure
    rather than cancelling out.
    """
    rows = [line.replace(" ", "") for line in diagram.strip().splitlines()]
    rows = [row for row in rows if row]
    size = len(rows)
    if any(len(row) != size for row in rows):
        raise ValueError("ownership diagram must be square")
    return [_OWNERSHIP_SYMBOLS[symbol] for row in rows for symbol in row]


def ownership_with(board_size: int, values: dict[Point, float], default: float = 0.0):
    """A flat array with exact values at chosen points, for threshold work."""
    array = [default] * (board_size * board_size)
    for point, value in values.items():
        array[(board_size - 1 - point.row) * board_size + point.col] = value
    return array


def _ctx(board: Board, move: Move, *, visits: int = 500, **kwargs: Any):
    """A context with reliable-looking visit counts on both analysis passes."""
    root = {"visits": visits}
    kwargs.setdefault("move_number", 50)
    kwargs.setdefault("root_info", root)
    kwargs.setdefault("root_info_before", root)
    return context_for_move(board, move, **kwargs)


# ── Hazard 1: array orientation ───────────────────────────────────────────────

# Both markers sit off the diagram's diagonal, off-centre, and in different rows and
# columns from one another. Corner markers will not do: the top-left and bottom-right
# cells of the array are fixed points of transposition, so a diagram built on them is
# symmetric under exactly the corruption it is meant to detect.
#
# Black at diagram (0, 1) is board Point(4, 1); White at diagram (3, 0) is Point(1, 0).
_ASYMMETRIC = """
. B . . .
. . . . .
. . . . .
W . . . .
. . . . .
"""

_BLACK_MARK = Point(4, 1)
_WHITE_MARK = Point(1, 0)


def _corrupt(flat: list[float], kind: str) -> OwnershipMap:
    """Feed the map a deliberately mangled array, the way a regression would."""
    if kind == "transposed":
        values = [flat[col * 5 + row] for row in range(5) for col in range(5)]
    elif kind == "row-inverted":
        values = [flat[(4 - row) * 5 + col] for row in range(5) for col in range(5)]
    else:
        values = [flat[row * 5 + (4 - col)] for row in range(5) for col in range(5)]
    return OwnershipMap.build(values, 5)


def test_ownership_maps_onto_the_board_the_way_the_engine_sends_it() -> None:
    ownership = OwnershipMap.build(ownership_from_ascii(_ASYMMETRIC), 5)
    # The first line of the diagram is the top of the board, i.e. our highest row.
    assert ownership.at(_BLACK_MARK) == pytest.approx(1.0)
    assert ownership.at(_WHITE_MARK) == pytest.approx(-1.0)
    # Every point a corruption would move a marker onto is empty here.
    for elsewhere in (Point(3, 0), Point(0, 1), Point(4, 3)):
        assert ownership.at(elsewhere) == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("kind", "lands_on"),
    [
        ("transposed", Point(3, 0)),
        ("row-inverted", Point(0, 1)),
        ("column-inverted", Point(4, 3)),
    ],
)
def test_the_orientation_check_would_catch_each_corruption(kind: str, lands_on: Point) -> None:
    """Not a tautology: each mangled feed must give a visibly different answer.

    A misread array is the worst bug available in this codebase — it stays
    well-formed, so every downstream claim about territory comes out confident and
    wrong. These pin that the check above is genuinely sensitive to all three ways
    it can happen.
    """
    ownership = _corrupt(ownership_from_ascii(_ASYMMETRIC), kind)
    assert ownership.at(_BLACK_MARK) == pytest.approx(0.0)  # the marker is not there
    assert ownership.at(lands_on) == pytest.approx(1.0)  # it moved here instead


@pytest.mark.parametrize("size", [9, 13, 19])
def test_ownership_indexing_covers_every_point_exactly_once(size: int) -> None:
    values = list(range(size * size))
    ownership = OwnershipMap.build([float(v) for v in values], size)
    seen = {ownership.at(Point(row, col)) for row in range(size) for col in range(size)}
    assert len(seen) == size * size


# ── Hazard 2: perspective ─────────────────────────────────────────────────────


def test_the_same_ownership_means_opposite_things_to_the_two_colours() -> None:
    ownership = OwnershipMap.build(ownership_with(5, {Point(2, 2): -0.9}), 5)
    assert ownership.for_color(Point(2, 2), Color.WHITE) == pytest.approx(0.9)
    assert ownership.for_color(Point(2, 2), Color.BLACK) == pytest.approx(-0.9)


def test_identical_ownership_reads_as_settled_or_dying_by_the_chains_colour() -> None:
    """A Black chain in strongly-White ownership is a dying Black group.

    Calling that "White territory" would describe the board correctly while missing
    the thing that actually happened to the player being taught.
    """
    strongly_white = ownership_with(5, {Point(2, 1): -0.9, Point(2, 2): -0.9})

    black = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.BLACK,
    )
    white = board_from_ascii(
        """
        . . . . .
        . . . . .
        . O . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )

    black_finding = detect_group_settledness(_ctx(black, Point(2, 2), ownership=strongly_white))
    white_finding = detect_group_settledness(_ctx(white, Point(2, 2), ownership=strongly_white))
    assert black_finding is not None and "(dying)" in black_finding.detail
    assert white_finding is not None and "(settled)" in white_finding.detail
    # Only the endangered side is escalated.
    assert black_finding.salience is Salience.CRITICAL
    assert white_finding.salience is Salience.BACKGROUND


# ── Malformed input ───────────────────────────────────────────────────────────


def test_a_mismatched_ownership_length_raises() -> None:
    """A protocol fault, not absent data — indexing on would misplace every claim."""
    with pytest.raises(OwnershipLengthError, match="361"):
        OwnershipMap.build([0.0] * 81, 19)


def test_a_mismatched_ownership_length_raises_through_the_context() -> None:
    context = _ctx(Board(19), Point(3, 3), ownership=[0.0] * 81)
    with pytest.raises(OwnershipLengthError):
        _ = context.ownership_map


def test_the_mean_of_no_points_raises() -> None:
    ownership = OwnershipMap.build([0.0] * 25, 5)
    with pytest.raises(ValueError, match="no points"):
        ownership.mean_for([], Color.BLACK)


# ── Missing and unreliable data ───────────────────────────────────────────────


def _settled_board() -> Board:
    return board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . . .
        . . . . .
        . . . . .
        """
    )


@pytest.mark.parametrize("detector", TIER_2_DETECTORS, ids=lambda d: d.__name__)
def test_every_detector_is_silent_without_katago_data(detector) -> None:
    """The correct output for missing data is silence, not a hedge.

    A missing finding costs nothing. A fabricated one breaks the guarantee the block
    header makes about everything inside it.
    """
    context = context_for_move(_settled_board(), Point(2, 2), move_number=50)
    assert detector(context) is None


@pytest.mark.parametrize("detector", TIER_2_DETECTORS, ids=lambda d: d.__name__)
def test_every_detector_is_silent_below_the_visit_floor(detector) -> None:
    """The shallow pass runs at 50 visits, where ownership and PVs are noise."""
    ownership = ownership_with(5, {Point(2, 2): 0.9})
    context = _ctx(
        _settled_board(),
        Point(2, 2),
        visits=50,
        ownership=ownership,
        ownership_before=ownership,
        move_infos=[{"move": "C3", "order": 0, "prior": 0.4, "pv": ["C3", "C4"]}],
    )
    assert detector(context) is None


def test_no_tier_2_finding_survives_a_shallow_pass_move() -> None:
    context = context_for_move(_settled_board(), Point(2, 2), move_number=50)
    concepts = {finding.concept for finding in run_detectors(context)}
    assert concepts.isdisjoint(
        {detector.__name__[len("detect_") :] for detector in TIER_2_DETECTORS}
    )


def test_detectors_needing_both_positions_are_silent_with_only_one() -> None:
    ownership = ownership_with(5, {Point(2, 2): 0.9})
    context = _ctx(_settled_board(), Point(2, 2), ownership=ownership)
    assert detect_settledness_change(context) is None
    assert detect_local_ownership_swing(context) is None
    # The single-position detectors still work.
    assert detect_group_settledness(context) is not None


def test_settledness_is_silent_on_a_pass() -> None:
    context = _ctx(_settled_board(), PASS, ownership=ownership_with(5, {Point(2, 2): 0.9}))
    assert detect_group_settledness(context) is None


# ── Group settledness ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("value", "band"),
    [
        (0.60, "settled"),  # exactly the boundary
        (0.59, "unsettled"),
        (0.00, "unsettled"),
        (-0.59, "unsettled"),
        (-0.60, "dying"),  # exactly the boundary
    ],
)
def test_settledness_bands_at_their_boundaries(value: float, band: str) -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . . . .
        . . . . .
        . . . . .
        """
    )
    context = _ctx(board, Point(2, 2), ownership=ownership_with(5, {Point(2, 2): value}))
    finding = detect_group_settledness(context)
    assert finding is not None
    assert f"({band})" in finding.detail


def test_settledness_averages_across_the_whole_chain() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . . .
        . . . . .
        . . . . .
        """
    )
    # The chain is (2,1) + (2,2); one point strongly Black, the other neutral.
    context = _ctx(
        board, Point(2, 2), ownership=ownership_with(5, {Point(2, 1): 1.0, Point(2, 2): 0.0})
    )
    finding = detect_group_settledness(context)
    assert finding is not None
    assert "+0.50 (unsettled)" in finding.detail


def test_settledness_reports_nearby_chains_of_either_colour() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . . O .
        . . . . .
        . . . . .
        """
    )
    context = _ctx(
        board, Point(2, 1), ownership=ownership_with(5, {Point(2, 1): 0.9, Point(2, 3): -0.9})
    )
    finding = detect_group_settledness(context)
    assert finding is not None
    assert "Black at B3" in finding.detail
    assert "White at D3" in finding.detail
    # White's stone sits in strongly-White ownership, so from White's side it is settled.
    assert finding.detail.count("(settled)") == 2


def test_settledness_ignores_chains_beyond_the_nearby_distance() -> None:
    board = board_from_ascii(
        """
        . . . . . . . . O
        . . . . . . . . .
        . . . . . . . . .
        . . . . . . . . .
        . . . . . . . . .
        . . . . . . . . .
        . . . . . . . . .
        . . . . . . . . .
        . . . . . . . . .
        """
    )
    context = _ctx(board, Point(0, 0), ownership=ownership_with(9, {Point(0, 0): 0.9}))
    finding = detect_group_settledness(context)
    assert finding is not None
    assert "White" not in finding.detail


# ── Settledness change ────────────────────────────────────────────────────────


def test_settledness_change_reports_a_group_becoming_more_settled() -> None:
    board = _settled_board()
    before = ownership_with(5, {Point(2, 1): 0.0, Point(2, 2): 0.0})
    after = ownership_with(5, {Point(2, 1): 0.9, Point(2, 2): 0.9})
    finding = detect_settledness_change(
        _ctx(board, Point(2, 2), ownership=after, ownership_before=before)
    )
    assert finding is not None
    assert "more settled for Black" in finding.detail
    assert "+0.90" in finding.detail
    assert finding.salience is Salience.NOTABLE


def test_settledness_change_reports_a_group_becoming_less_settled() -> None:
    board = _settled_board()
    before = ownership_with(5, {Point(2, 1): 0.9, Point(2, 2): 0.9})
    after = ownership_with(5, {Point(2, 1): 0.0, Point(2, 2): 0.0})
    finding = detect_settledness_change(
        _ctx(board, Point(2, 2), ownership=after, ownership_before=before)
    )
    assert finding is not None
    assert "less settled for Black" in finding.detail


def test_settledness_change_is_silent_below_the_noise_floor() -> None:
    board = _settled_board()
    before = ownership_with(5, {Point(2, 1): 0.50, Point(2, 2): 0.50})
    after = ownership_with(5, {Point(2, 1): 0.55, Point(2, 2): 0.55})
    assert (
        detect_settledness_change(
            _ctx(board, Point(2, 2), ownership=after, ownership_before=before)
        )
        is None
    )


def test_settledness_change_is_owner_relative_for_white_too() -> None:
    """White's group settling means ownership going *more negative*."""
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . O . . .
        . . . . .
        . . . . .
        """,
        to_play=Color.WHITE,
    )
    before = ownership_with(5, {Point(2, 1): 0.0, Point(2, 2): 0.0})
    after = ownership_with(5, {Point(2, 1): -0.9, Point(2, 2): -0.9})
    finding = detect_settledness_change(
        _ctx(board, Point(2, 2), ownership=after, ownership_before=before)
    )
    assert finding is not None
    assert "more settled for White" in finding.detail


# ── Direction of play and area choice ─────────────────────────────────────────

# On 9x9 the thirds fall at 3 and 6, so the top-right 3x3 block of the diagram is the
# "upper-right" region. Everything else is fully settled and therefore uncontested.
_NINE_UPPER_RIGHT_OPEN = """
B B B B B B . . .
B B B B B B . . .
B B B B B B . . .
B B B B B B B B B
B B B B B B B B B
B B B B B B B B B
B B B B B B B B B
B B B B B B B B B
B B B B B B B B B
"""


def test_direction_of_play_finds_the_most_contested_region() -> None:
    ownership = ownership_from_ascii(_NINE_UPPER_RIGHT_OPEN)
    finding = detect_direction_of_play(_ctx(Board(9), Point(0, 0), ownership=ownership))
    assert finding is not None
    assert "upper-right" in finding.detail
    assert "9 points" in finding.detail
    assert finding.certainty is Certainty.HEURISTIC


def test_move_played_away_from_the_largest_area_is_reported_as_a_comparison() -> None:
    """The most common kyu mistake, phrased as measured sizes rather than a verdict."""
    ownership = ownership_from_ascii(_NINE_UPPER_RIGHT_OPEN)
    finding = detect_move_in_largest_area(_ctx(Board(9), Point(0, 0), ownership=ownership))
    assert finding is not None
    assert "lower-left" in finding.detail
    assert "upper-right" in finding.detail
    assert finding.certainty is Certainty.HEURISTIC
    for judgement in ("should", "mistake", "bad", "wrong", "better"):
        assert judgement not in finding.detail.lower()


def test_a_substantial_miss_is_critical_on_9x9() -> None:
    """The gap threshold scales with the board; a flat count of 10 could never fire
    here, where a whole region holds only 9 points."""
    ownership = ownership_from_ascii(_NINE_UPPER_RIGHT_OPEN)
    finding = detect_move_in_largest_area(_ctx(Board(9), Point(0, 0), ownership=ownership))
    assert finding is not None
    assert finding.salience is Salience.CRITICAL


def test_playing_in_the_largest_area_is_reported_without_escalation() -> None:
    ownership = ownership_from_ascii(_NINE_UPPER_RIGHT_OPEN)
    finding = detect_move_in_largest_area(_ctx(Board(9), Point(8, 8), ownership=ownership))
    assert finding is not None
    assert "also the most contested region" in finding.detail
    assert finding.salience is Salience.NOTABLE


def test_region_partition_scales_to_13x13() -> None:
    """Thirds fall at 4 and 8, so rows/cols 8-12 are the upper and right bands."""
    rows = ["." * 5 + "B" * 8] * 5 + ["B" * 13] * 8
    ownership = ownership_from_ascii("\n".join(rows))
    finding = detect_direction_of_play(_ctx(Board(13), Point(0, 0), ownership=ownership))
    assert finding is not None
    assert "upper-left" in finding.detail


# ── Local ownership swing ─────────────────────────────────────────────────────


@pytest.mark.parametrize(("size", "expected"), [(19, "5x5"), (13, "5x5"), (9, "3x3")])
def test_local_box_scales_with_board_size(size: int, expected: str) -> None:
    centre = Point(size // 2, size // 2)
    before = ownership_with(size, {})
    after = ownership_with(size, {}, default=1.0)
    finding = detect_local_ownership_swing(
        _ctx(Board(size), centre, ownership=after, ownership_before=before)
    )
    assert finding is not None
    assert expected in finding.detail


def test_local_swing_sums_the_delta_over_the_box() -> None:
    """A 3x3 box on 9x9 moving from neutral to fully Black is +9 points."""
    before = ownership_with(9, {})
    after = ownership_with(9, {}, default=1.0)
    finding = detect_local_ownership_swing(
        _ctx(Board(9), Point(4, 4), ownership=after, ownership_before=before)
    )
    assert finding is not None
    assert "+9.0 points toward Black" in finding.detail


def test_local_swing_is_owner_relative() -> None:
    """The same board-level shift reads as a gain for whoever played."""
    before = ownership_with(9, {})
    after = ownership_with(9, {}, default=-1.0)
    finding = detect_local_ownership_swing(
        _ctx(
            Board(9).with_to_play(Color.WHITE),
            Point(4, 4),
            ownership=after,
            ownership_before=before,
        )
    )
    assert finding is not None
    assert "+9.0 points toward White" in finding.detail


def test_local_swing_is_silent_when_nothing_moved() -> None:
    ownership = ownership_with(9, {})
    assert (
        detect_local_ownership_swing(
            _ctx(Board(9), Point(4, 4), ownership=ownership, ownership_before=ownership)
        )
        is None
    )


def test_local_swing_box_is_clipped_at_the_board_edge() -> None:
    before = ownership_with(9, {})
    after = ownership_with(9, {}, default=1.0)
    finding = detect_local_ownership_swing(
        _ctx(Board(9), Point(0, 0), ownership=after, ownership_before=before)
    )
    assert finding is not None
    # A corner sees only the 2x2 quarter of its 3x3 box that is on the board.
    assert "+4.0 points" in finding.detail


# ── Sente / gote ──────────────────────────────────────────────────────────────


def _with_pv(reply: str) -> list[dict[str, Any]]:
    return [{"move": "C3", "order": 0, "prior": 0.4, "pv": ["C3", reply]}]


@pytest.mark.parametrize(
    ("reply", "distance", "shape"),
    [
        ("C6", 3, "locally sente"),
        ("C7", 4, "locally sente"),  # exactly the threshold
        ("C8", 5, "locally gote"),  # one point past it
    ],
)
def test_sente_gote_at_and_around_the_distance_threshold(
    reply: str, distance: int, shape: str
) -> None:
    finding = detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=_with_pv(reply)))
    assert finding is not None
    assert shape in finding.detail
    assert f"{distance} point" in finding.detail
    assert finding.certainty is Certainty.HEURISTIC


def test_sente_gote_reads_only_the_opponents_immediate_reply() -> None:
    """Deep PV moves are close to speculative, so nothing reads past index 1."""
    move_infos = [{"move": "C3", "order": 0, "pv": ["C3", "C7", "R17", "A1", "T19"]}]
    finding = detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=move_infos))
    assert finding is not None
    assert finding.points == (Point(6, 2),)


def test_sente_gote_is_silent_when_the_played_move_is_not_a_candidate() -> None:
    move_infos = [{"move": "Q16", "order": 0, "pv": ["Q16", "D4"]}]
    assert detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=move_infos)) is None


def test_sente_gote_is_silent_when_the_pv_has_no_reply() -> None:
    assert (
        detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=[{"move": "C3", "pv": ["C3"]}]))
        is None
    )


def test_sente_gote_is_silent_when_the_reply_is_a_pass() -> None:
    assert detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=_with_pv("pass"))) is None


def test_sente_gote_is_silent_on_a_malformed_pv_coordinate() -> None:
    assert detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=_with_pv("I5"))) is None


def test_sente_gote_is_silent_with_no_candidates() -> None:
    assert detect_sente_gote(_ctx(Board(19), Point(2, 2), move_infos=[])) is None


# ── Move ranking (unregistered) ───────────────────────────────────────────────


def test_move_ranking_is_not_in_the_default_registry() -> None:
    """Rank and policy prior already live in the [KATAGO ANALYSIS DATA] block.

    Two blocks in one prompt computing the same value independently is how the
    prompt ends up contradicting itself, so this value has exactly one home.
    """
    assert detect_move_ranking not in DETECTORS


def test_no_registered_detector_reports_a_move_rank() -> None:
    context = _ctx(
        Board(19),
        Point(2, 2),
        ownership=ownership_with(19, {}),
        ownership_before=ownership_with(19, {}),
        move_infos=_with_pv("C7"),
    )
    labels = {finding.label for finding in run_detectors(context)}
    assert "Move rank" not in labels


def test_move_ranking_reports_the_rank_and_prior_when_called_directly() -> None:
    move_infos = [{"move": "C3", "order": 0, "prior": 0.412, "pv": ["C3"]}]
    finding = detect_move_ranking(_ctx(Board(19), Point(2, 2), move_infos=move_infos))
    assert finding is not None
    assert "1st choice" in finding.detail
    assert "0.412" in finding.detail


def test_move_ranking_handles_a_move_outside_the_candidate_list() -> None:
    """A bad enough move falls off a truncated list. That is a fact about the move,
    not rank zero and not a crash."""
    move_infos = [{"move": "Q16", "order": 0}, {"move": "D4", "order": 1}]
    finding = detect_move_ranking(_ctx(Board(19), Point(2, 2), move_infos=move_infos))
    assert finding is not None
    assert "outside the engine's top 2 candidates" in finding.detail


# ── Renderer integration ──────────────────────────────────────────────────────


def test_heuristic_tier_2_findings_render_hedged_and_exact_ones_do_not() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . . .
        . . . . .
        . . . . .
        """
    )
    ownership = ownership_with(5, {Point(2, 1): -0.9, Point(2, 2): -0.9})
    text = render_detected_features(run_detectors(_ctx(board, Point(2, 2), ownership=ownership)))
    settledness = next(line for line in text.splitlines() if "Settledness:" in line)
    area = next(line for line in text.splitlines() if "Area choice:" in line)
    assert "estimated —" not in settledness
    assert "estimated — " in area


def test_a_dying_friendly_group_outranks_background_board_facts() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . . .
        . . . . .
        . . . . .
        """
    )
    ownership = ownership_with(5, {Point(2, 1): -0.9, Point(2, 2): -0.9})
    findings = run_detectors(_ctx(board, Point(2, 2), ownership=ownership))
    assert findings[0].concept == "group_settledness"
    assert findings[0].salience is Salience.CRITICAL


def test_the_block_stays_within_its_line_cap_with_tier_2_active() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . O .
        . X . . .
        . . . . .
        . . . . .
        """
    )
    ownership = ownership_with(5, {Point(2, 1): -0.9, Point(2, 2): -0.9})
    text = render_detected_features(
        run_detectors(
            _ctx(
                board,
                Point(2, 2),
                ownership=ownership,
                ownership_before=ownership_with(5, {}),
                move_infos=_with_pv("C7"),
            )
        )
    )
    body = [line for line in text.splitlines() if line.startswith("  ")]
    assert len(body) == 8
