"""The concept detectors and feature renderer in ``app.services.concepts``.

Every detector gets a case where it fires with the exact points asserted, and a case
where it must stay silent. A detector that fires when it shouldn't puts a false
"fact" in front of the model with a header telling it the line may be stated as
certain, which is worse than the vague commentary this layer replaces.

Positions come from the shared ASCII helper, top row first: ``.`` empty, ``X`` black,
``O`` white.
"""

from typing import Any

import pytest
from board_fixtures import board_from_ascii

from app.services.board import PASS, Board, Color, Move, Point, SuicideError
from app.services.concepts import (
    DETECTORS,
    Certainty,
    DetectorContext,
    Finding,
    Salience,
    context_for_move,
    detect_atari_given,
    detect_atari_ignored,
    detect_board_zone,
    detect_capture,
    detect_connection,
    detect_contact_play,
    detect_double_atari,
    detect_extension,
    detect_game_phase,
    detect_ko_capture,
    detect_liberty_count,
    detect_line_number,
    detect_self_atari,
    detect_tenuki,
    render_detected_features,
    run_detectors,
)


def _ctx(board: Board, move: Move, **kwargs: Any) -> DetectorContext:
    kwargs.setdefault("move_number", 1)
    return context_for_move(board, move, **kwargs)


def _concepts(context: DetectorContext) -> list[str]:
    return [finding.concept for finding in run_detectors(context)]


# ── Context ───────────────────────────────────────────────────────────────────


def test_context_exposes_the_played_point_and_colour() -> None:
    context = _ctx(Board(9).with_to_play(Color.WHITE), Point(4, 4))
    assert context.point == Point(4, 4)
    assert context.color is Color.WHITE
    assert context.board_size == 9
    assert not context.is_pass
    assert context.board_after.get(Point(4, 4)) is Color.WHITE


def test_context_reports_no_point_for_a_pass() -> None:
    context = _ctx(Board(9), PASS)
    assert context.point is None
    assert context.is_pass


def test_context_carries_katago_data_untouched() -> None:
    """Tier 1 reads none of this; Tier 2 reads all of it."""
    root = {"currentPlayer": "B"}
    moves = [{"move": "Q16", "order": 0}]
    ownership = [0.0] * 81
    context = _ctx(Board(9), Point(4, 4), root_info=root, move_infos=moves, ownership=ownership)
    assert context.root_info is root
    assert context.move_infos is moves
    assert context.ownership is ownership


def test_context_rejects_mismatched_boards() -> None:
    result = Board(9).place_move(Point(4, 4))
    with pytest.raises(ValueError, match="different board sizes"):
        DetectorContext(board_before=Board(13), result=result, move_number=1)


def test_context_rejects_a_negative_move_number() -> None:
    board = Board(9)
    with pytest.raises(ValueError, match="move_number"):
        DetectorContext(board_before=board, result=board.place_move(Point(4, 4)), move_number=-1)


# ── Contact play ──────────────────────────────────────────────────────────────


def test_contact_play_fires_against_an_adjacent_enemy_stone() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . O . .
        . . . . .
        . . . . .
        """
    )
    finding = detect_contact_play(_ctx(board, Point(2, 1)))
    assert finding is not None
    assert finding.concept == "contact_play"
    assert finding.points == (Point(2, 2),)
    assert finding.salience is Salience.NOTABLE
    assert finding.certainty is Certainty.EXACT


def test_contact_play_is_silent_when_no_enemy_stone_is_adjacent() -> None:
    """A diagonal enemy stone is not contact — diagonals are not adjacency."""
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . O . .
        . . . . .
        . . . . .
        """
    )
    assert detect_contact_play(_ctx(board, Point(1, 1))) is None


def test_contact_play_is_silent_on_a_pass() -> None:
    assert detect_contact_play(_ctx(Board(9), PASS)) is None


# ── Extension ─────────────────────────────────────────────────────────────────


def test_extension_fires_against_an_adjacent_friendly_stone() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . X . .
        . . . . .
        . . . . .
        """
    )
    finding = detect_extension(_ctx(board, Point(2, 1)))
    assert finding is not None
    assert finding.points == (Point(2, 2),)


def test_extension_is_silent_when_only_an_enemy_stone_is_adjacent() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . O . .
        . . . . .
        . . . . .
        """
    )
    assert detect_extension(_ctx(board, Point(2, 1))) is None


# ── Connection ────────────────────────────────────────────────────────────────


def test_connection_fires_when_two_chains_are_joined() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . X .
        . . . . .
        . . . . .
        """
    )
    finding = detect_connection(_ctx(board, Point(2, 2)))
    assert finding is not None
    assert finding.points == (Point(2, 1), Point(2, 3))
    assert "2 previously separate" in finding.detail


def test_connection_is_silent_when_only_one_chain_is_adjacent() -> None:
    """Touching one friendly chain is an extension, not a connection."""
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . X . . .
        . . . . .
        . . . . .
        """
    )
    context = _ctx(board, Point(2, 2))
    assert detect_connection(context) is None
    assert detect_extension(context) is not None


def test_connection_counts_chains_not_adjacent_stones() -> None:
    """Two adjacent stones already in one chain are one chain, not two."""
    board = board_from_ascii(
        """
        . . . . .
        . X X . .
        . X . . .
        . . . . .
        . . . . .
        """
    )
    # (2, 2) touches the black stones at (3, 2) and (2, 1), which are already joined
    # through (3, 1).
    assert detect_connection(_ctx(board, Point(2, 2))) is None


# ── Liberty count ─────────────────────────────────────────────────────────────


def test_liberty_count_reports_the_played_chain() -> None:
    finding = detect_liberty_count(_ctx(Board(9), Point(4, 4)))
    assert finding is not None
    assert len(finding.points) == 4
    assert "4 liberties" in finding.detail
    assert finding.salience is Salience.BACKGROUND


def test_liberty_count_is_silent_on_a_pass() -> None:
    assert detect_liberty_count(_ctx(Board(9), PASS)) is None


# ── Atari given ───────────────────────────────────────────────────────────────


def _atari_given_position() -> Board:
    """White (2, 2) has two liberties; black at (1, 2) takes one of them."""
    return board_from_ascii(
        """
        . . . . .
        . . X . .
        . X O . .
        . . . . .
        . . . . .
        """
    )


def test_atari_given_fires_when_a_chain_drops_to_one_liberty() -> None:
    finding = detect_atari_given(_ctx(_atari_given_position(), Point(1, 2)))
    assert finding is not None
    assert finding.points == (Point(2, 2),)
    assert finding.salience is Salience.CRITICAL


def test_atari_given_is_silent_when_the_chain_keeps_two_liberties() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . . .
        . . O . .
        . . . . .
        . . . . .
        """
    )
    assert detect_atari_given(_ctx(board, Point(2, 1))) is None


def test_atari_given_ignores_a_chain_that_was_already_in_atari() -> None:
    """The critical before/after case.

    White (4, 0) sits at one liberty before the move and is untouched by it. An
    implementation that simply scans for enemy chains at one liberty *after* the
    move would report it as an atari this move gave, which is false.
    """
    board = board_from_ascii(
        """
        O X . . .
        . . . . .
        . . X . .
        . X O . .
        . . . . .
        """
    )
    assert len(board.liberties(board.chain_at(Point(4, 0)))) == 1

    finding = detect_atari_given(_ctx(board, Point(1, 3)))
    assert finding is not None
    assert finding.points == (Point(1, 2),)
    assert Point(4, 0) not in finding.points
    assert detect_double_atari(_ctx(board, Point(1, 3))) is None


def test_a_chain_at_one_liberty_next_to_the_move_is_captured_not_ataried() -> None:
    """The complement of the case above.

    A surviving enemy chain adjacent to the played point always loses exactly one
    liberty, so one before means zero after — it is captured, and no atari is given.
    """
    board = board_from_ascii(
        """
        . . . . .
        . . X . .
        . X O . .
        . . X . .
        . . . . .
        """
    )
    context = _ctx(board, Point(2, 3))
    assert detect_atari_given(context) is None
    capture = detect_capture(context)
    assert capture is not None
    assert capture.points == (Point(2, 2),)


# ── Double atari ──────────────────────────────────────────────────────────────


def _double_atari_position() -> Board:
    """Black at (2, 2) puts both white stones onto their last liberty."""
    return board_from_ascii(
        """
        . . . . .
        . X . X .
        . O . O .
        . X . X .
        . . . . .
        """
    )


def test_double_atari_fires_and_reports_one_finding() -> None:
    finding = detect_double_atari(_ctx(_double_atari_position(), Point(2, 2)))
    assert finding is not None
    assert finding.points == (Point(2, 1), Point(2, 3))
    assert finding.salience is Salience.CRITICAL


def test_double_atari_is_silent_on_a_single_atari() -> None:
    assert detect_double_atari(_ctx(_atari_given_position(), Point(1, 2))) is None


def test_double_atari_supersedes_the_single_atari_line() -> None:
    """Both detectors fire independently; the aggregator drops the redundant one.

    Keeping both would spend two of the eight capped lines naming the same chains.
    The suppression is a declared ``supersedes`` edge, not logic inside either
    detector — neither knows the other exists.
    """
    context = _ctx(_double_atari_position(), Point(2, 2))
    assert detect_atari_given(context) is not None
    assert detect_double_atari(context) is not None

    concepts = _concepts(context)
    assert "double_atari" in concepts
    assert "atari_given" not in concepts


# ── Self-atari ────────────────────────────────────────────────────────────────


def test_self_atari_fires_at_exactly_one_liberty() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O . . .
        . . O . .
        . . . . .
        """
    )
    finding = detect_self_atari(_ctx(board, Point(2, 2)))
    assert finding is not None
    assert finding.points == (Point(2, 2),)
    assert finding.salience is Salience.CRITICAL
    assert finding.certainty is Certainty.EXACT


def test_self_atari_reports_the_count_without_ranking_the_move() -> None:
    """Self-atari is correct in throw-ins, nakade, and snapbacks.

    The detector must never call it a mistake — that judgement belongs to the model,
    which can see the surrounding context this layer cannot.
    """
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O . . .
        . . O . .
        . . . . .
        """
    )
    finding = detect_self_atari(_ctx(board, Point(2, 2)))
    assert finding is not None
    lowered = finding.detail.lower()
    for judgement in ("bad", "mistake", "blunder", "error", "should", "inefficient"):
        assert judgement not in lowered


def test_self_atari_is_silent_at_two_liberties() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O . . .
        . . . . .
        . . . . .
        """
    )
    assert detect_self_atari(_ctx(board, Point(2, 2))) is None


def test_the_boundary_between_self_atari_and_suicide() -> None:
    """One liberty is legal and observable; zero raises in Tier 0 and never
    reaches a detector at all."""
    legal = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O . . .
        . . O . .
        . . . . .
        """
    )
    assert detect_self_atari(_ctx(legal, Point(2, 2))) is not None

    suicidal = board_from_ascii(
        """
        . . . . .
        . . O . .
        . O . O .
        . . O . .
        . . . . .
        """
    )
    with pytest.raises(SuicideError):
        _ctx(suicidal, Point(2, 2))


# ── Atari ignored ─────────────────────────────────────────────────────────────


def _atari_ignored_position() -> Board:
    """Black's corner stone at (8, 8) is in atari, with its liberty at (7, 8)."""
    return board_from_ascii(
        """
        . . . . . . . O X
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


#: The white move that created the atari, one point to the left of Black's stone.
_ATARI_SOURCE = Point(8, 7)


def test_atari_ignored_fires_when_the_endangered_chain_is_far_away() -> None:
    """The whole board must be scanned, not just the neighbourhood of the move.

    "Your group in the upper right was in atari and you played in the lower left" is
    a complete lesson, and it is invisible to anything that looks only locally.
    """
    board = _atari_ignored_position()
    assert len(board.liberties(board.chain_at(Point(8, 8)))) == 1

    finding = detect_atari_ignored(_ctx(board, Point(0, 0), previous_move=_ATARI_SOURCE))
    assert finding is not None
    assert finding.points == (Point(8, 8),)
    assert finding.salience is Salience.CRITICAL


def test_atari_ignored_reports_each_atari_once_not_once_per_move() -> None:
    """The redundancy fix: an abandoned group stays in atari until it is captured.

    Reporting it every move afterwards re-issues one lesson dozens of times at
    critical salience — measured at 51% of moves in a real game, from only 19 actual
    groups. The atari counts as news only on the move that answers it.
    """
    board = _atari_ignored_position()
    # The opponent played somewhere else entirely, so this atari is not new.
    stale = _ctx(board, Point(0, 0), previous_move=Point(0, 4))
    assert detect_atari_ignored(stale) is None


def test_atari_ignored_needs_a_previous_move_to_tell_fresh_from_stale() -> None:
    """No way to distinguish the two without it, so it stays silent rather than
    guess — the same rule the KataGo-derived detectors follow."""
    board = _atari_ignored_position()
    assert detect_atari_ignored(_ctx(board, Point(0, 0))) is None


def test_atari_ignored_is_silent_when_the_opponent_passed() -> None:
    """A pass cannot have created an atari."""
    board = _atari_ignored_position()
    assert detect_atari_ignored(_ctx(board, Point(0, 0), previous_move=PASS)) is None


def test_atari_ignored_names_the_move_that_created_the_atari() -> None:
    board = _atari_ignored_position()
    finding = detect_atari_ignored(_ctx(board, Point(0, 0), previous_move=_ATARI_SOURCE))
    assert finding is not None
    assert "H9" in finding.detail  # the white stone at Point(8, 7)


def test_atari_ignored_is_silent_when_nothing_was_in_atari() -> None:
    assert detect_atari_ignored(_ctx(Board(9), Point(4, 4), previous_move=Point(4, 5))) is None


def test_atari_ignored_is_silent_when_the_move_connects_to_the_chain() -> None:
    board = _atari_ignored_position()
    context = _ctx(board, Point(7, 8), previous_move=_ATARI_SOURCE)
    assert detect_atari_ignored(context) is None
    assert context.result.liberty_count == 2


def test_atari_ignored_is_silent_when_the_move_captures_the_surrounder() -> None:
    board = board_from_ascii(
        """
        . . . O X
        . . . X .
        . . . . .
        . . . . .
        . . . . .
        """
    )
    assert len(board.liberties(board.chain_at(Point(4, 4)))) == 1

    context = _ctx(board, Point(4, 2), previous_move=Point(4, 3))
    assert detect_capture(context) is not None
    assert detect_atari_ignored(context) is None


def test_atari_ignored_fires_on_a_pass() -> None:
    """Passing while a group was just put in atari is the same lesson."""
    finding = detect_atari_ignored(
        _ctx(_atari_ignored_position(), PASS, previous_move=_ATARI_SOURCE)
    )
    assert finding is not None
    assert finding.points == (Point(8, 8),)


def test_atari_ignored_only_looks_at_friendly_chains() -> None:
    """A white chain in atari is not black's ignored group."""
    board = board_from_ascii(
        """
        . . . X O
        . . . . .
        . . . . .
        . . . . .
        . . . . .
        """
    )
    assert len(board.liberties(board.chain_at(Point(4, 4)))) == 1
    assert detect_atari_ignored(_ctx(board, Point(0, 0), previous_move=Point(4, 3))) is None


# ── Capture ───────────────────────────────────────────────────────────────────


def test_capture_reports_count_and_location() -> None:
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
    finding = detect_capture(_ctx(board, Point(3, 3)))
    assert finding is not None
    assert finding.points == (Point(3, 1), Point(3, 2))
    assert "2 Black stones" in finding.detail


def test_capture_is_silent_on_a_quiet_move() -> None:
    assert detect_capture(_ctx(Board(9), Point(4, 4))) is None


def test_capture_that_also_resolves_the_played_chains_shortage() -> None:
    """The capture-first case: white's stone would have no liberties on its own.

    Removing the black chain both registers as a capture and leaves the played
    stone comfortable, so self-atari must not fire.
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
    context = _ctx(board, Point(4, 0))

    capture = detect_capture(context)
    assert capture is not None
    assert capture.points == (Point(3, 0), Point(3, 1), Point(4, 1))
    assert detect_self_atari(context) is None
    liberties = detect_liberty_count(context)
    assert liberties is not None
    assert liberties.points == (Point(3, 0), Point(4, 1))


# ── Ko ────────────────────────────────────────────────────────────────────────


def _ko_position() -> Board:
    return board_from_ascii(
        """
        . . . . .
        . X O . .
        X O . O .
        . X O . .
        . . . . .
        """
    )


def test_ko_capture_fires_on_a_one_stone_capture_that_opens_a_ko() -> None:
    finding = detect_ko_capture(_ctx(_ko_position(), Point(2, 2)))
    assert finding is not None
    assert finding.points == (Point(2, 1),)
    assert finding.salience is Salience.CRITICAL


def test_ko_capture_is_silent_on_a_multi_stone_capture() -> None:
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
    context = _ctx(board, Point(3, 3))
    assert detect_capture(context) is not None
    assert detect_ko_capture(context) is None


def test_ko_capture_is_silent_when_nothing_is_captured() -> None:
    assert detect_ko_capture(_ctx(Board(9), Point(4, 4))) is None


# ── Line number ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("size", "point", "expected"),
    [
        (9, Point(0, 0), "1st"),
        (9, Point(2, 2), "3rd"),
        (9, Point(4, 4), "5th"),
        (9, Point(0, 4), "1st"),
        (13, Point(3, 3), "4th"),
        (13, Point(6, 6), "7th"),
        (13, Point(1, 6), "2nd"),
        (19, Point(3, 3), "4th"),
        (19, Point(2, 15), "3rd"),
        (19, Point(9, 9), "10th"),
    ],
)
def test_line_number_on_every_supported_size(size: int, point: Point, expected: str) -> None:
    finding = detect_line_number(_ctx(Board(size), point))
    assert finding is not None
    assert f"{expected} line" in finding.detail


def test_line_number_is_silent_on_a_pass() -> None:
    assert detect_line_number(_ctx(Board(9), PASS)) is None


# ── Board zone ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("size", "point", "expected"),
    [
        # 19x19: the outer band is 7 lines, so the center is the middle 5x5.
        (19, Point(3, 3), "lower-left corner"),
        (19, Point(15, 15), "upper-right corner"),
        (19, Point(3, 9), "lower side"),
        (19, Point(9, 3), "left side"),
        (19, Point(9, 9), "center"),
        # 13x13: band of 5.
        (13, Point(2, 2), "lower-left corner"),
        (13, Point(2, 6), "lower side"),
        (13, Point(6, 6), "center"),
        # 9x9: band of 3.
        (9, Point(0, 0), "lower-left corner"),
        (9, Point(0, 4), "lower side"),
        (9, Point(4, 4), "center"),
    ],
)
def test_board_zone_scales_with_board_size(size: int, point: Point, expected: str) -> None:
    finding = detect_board_zone(_ctx(Board(size), point))
    assert finding is not None
    assert expected in finding.detail


def test_board_zone_is_marked_heuristic() -> None:
    finding = detect_board_zone(_ctx(Board(19), Point(3, 3)))
    assert finding is not None
    assert finding.certainty is Certainty.HEURISTIC


def test_board_zone_is_silent_on_a_pass() -> None:
    assert detect_board_zone(_ctx(Board(9), PASS)) is None


# ── Tenuki ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("point", "fires"),
    [
        (Point(0, 4), False),  # distance 4 — one below the threshold
        (Point(0, 5), True),  # distance 5 — exactly the threshold
        (Point(0, 6), True),  # distance 6 — one above
    ],
)
def test_tenuki_at_and_around_the_threshold(point: Point, fires: bool) -> None:
    board = Board(19).place_setup_stones(white=[Point(0, 0)])
    finding = detect_tenuki(_ctx(board, point, previous_move=Point(0, 0)))
    assert (finding is not None) is fires
    if finding is not None:
        assert finding.certainty is Certainty.HEURISTIC
        assert finding.points == (Point(0, 0),)


def test_tenuki_measures_chebyshev_distance() -> None:
    """A diagonal jump of 5 in both axes is distance 5, not 10."""
    board = Board(19).place_setup_stones(white=[Point(0, 0)])
    assert detect_tenuki(_ctx(board, Point(5, 5), previous_move=Point(0, 0))) is not None
    assert detect_tenuki(_ctx(board, Point(4, 4), previous_move=Point(0, 0))) is None


def test_tenuki_is_silent_without_a_previous_move() -> None:
    assert detect_tenuki(_ctx(Board(19), Point(3, 3))) is None


def test_tenuki_is_silent_when_the_previous_move_was_a_pass() -> None:
    assert detect_tenuki(_ctx(Board(19), Point(3, 3), previous_move=PASS)) is None


def test_tenuki_is_silent_when_this_move_is_a_pass() -> None:
    assert detect_tenuki(_ctx(Board(19), PASS, previous_move=Point(0, 0))) is None


# ── Game phase ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("size", "move_number", "expected"),
    [
        (19, 1, "opening"),
        (19, 70, "opening"),
        (19, 100, "middlegame"),
        (19, 250, "endgame"),
        (9, 10, "opening"),
        (9, 25, "middlegame"),
        (9, 50, "endgame"),
    ],
)
def test_game_phase_scales_with_board_size(size: int, move_number: int, expected: str) -> None:
    finding = detect_game_phase(_ctx(Board(size), Point(4, 4), move_number=move_number))
    assert finding is not None
    assert finding.detail.startswith(expected)
    assert finding.certainty is Certainty.HEURISTIC


def test_game_phase_uses_stone_count_when_it_outruns_the_move_number() -> None:
    """A handicap or setup-heavy position is further along than its move number."""
    board = Board(9).place_setup_stones(
        black=[Point(row, col) for row in range(6) for col in range(9)]
    )
    finding = detect_game_phase(_ctx(board, Point(6, 0), move_number=1))
    assert finding is not None
    assert finding.detail.startswith("endgame")


def test_game_phase_fires_on_a_pass() -> None:
    assert detect_game_phase(_ctx(Board(9), PASS)) is not None


# ── Detectors are independent ─────────────────────────────────────────────────


def test_one_move_can_be_contact_extension_and_atari_at_once() -> None:
    """Detectors are non-exclusive, and this is the common case, not an edge case.

    Black (2, 2) leans on the white stone at (2, 3), extends from its own stone at
    (2, 1), and takes white down to its last liberty. All three must fire.
    """
    board = board_from_ascii(
        """
        . . . . .
        . . . X .
        . X . O .
        . . . X .
        . . . . .
        """
    )
    context = _ctx(board, Point(2, 2))

    contact = detect_contact_play(context)
    extension = detect_extension(context)
    atari = detect_atari_given(context)
    assert contact is not None and contact.points == (Point(2, 3),)
    assert extension is not None and extension.points == (Point(2, 1),)
    assert atari is not None and atari.points == (Point(2, 3),)

    concepts = _concepts(context)
    assert {"contact_play", "extension", "atari_given"} <= set(concepts)


# ── Registry and aggregation ──────────────────────────────────────────────────


def test_every_registered_detector_has_a_unique_concept_key() -> None:
    """Concept keys are how ``supersedes`` refers across detectors, so collisions
    would silently suppress the wrong finding."""
    board = board_from_ascii(
        """
        . . . . .
        . . . X .
        . X . O .
        . . . X .
        . . . . .
        """
    )
    context = _ctx(board, Point(2, 2))
    keys = [finding.concept for detector in DETECTORS if (finding := detector(context)) is not None]
    assert len(keys) == len(set(keys))


def test_findings_come_back_most_salient_first() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . X .
        . X . O .
        . . . X .
        . . . . .
        """
    )
    findings = run_detectors(_ctx(board, Point(2, 2)))
    saliences = [finding.salience for finding in findings]
    assert saliences == sorted(saliences)
    assert findings[0].salience is Salience.CRITICAL


def test_a_quiet_move_produces_only_background_findings() -> None:
    findings = run_detectors(_ctx(Board(19), Point(3, 3)))
    assert {finding.concept for finding in findings} == {
        "liberty_count",
        "line_number",
        "board_zone",
        "game_phase",
    }
    assert all(finding.salience is Salience.BACKGROUND for finding in findings)


def test_no_detector_raises_on_a_pass() -> None:
    findings = run_detectors(_ctx(Board(19), PASS, move_number=200))
    assert [finding.concept for finding in findings] == ["game_phase"]


def test_suppression_is_applied_generically() -> None:
    """The mechanism, exercised without any real detector or concept involved."""
    winner = Finding(concept="winner", label="Winner", detail="wins", salience=Salience.CRITICAL)
    loser = Finding(concept="loser", label="Loser", detail="loses", salience=Salience.CRITICAL)
    findings = run_detectors(
        _ctx(Board(9), Point(4, 4)),
        detectors=[lambda _: winner, lambda _: loser],
        suppressions={"winner": frozenset({"loser"})},
    )
    assert [finding.concept for finding in findings] == ["winner"]


def test_suppression_only_bites_when_the_suppressing_finding_fired() -> None:
    loser = Finding(concept="loser", label="Loser", detail="loses", salience=Salience.CRITICAL)
    findings = run_detectors(
        _ctx(Board(9), Point(4, 4)),
        detectors=[lambda _: loser],
        suppressions={"winner": frozenset({"loser"})},
    )
    assert [finding.concept for finding in findings] == ["loser"]


def test_a_detector_returning_none_contributes_nothing() -> None:
    assert run_detectors(_ctx(Board(9), Point(4, 4)), detectors=[lambda _: None]) == ()


# ── Renderer ──────────────────────────────────────────────────────────────────


def _finding(concept: str, salience: Salience, **kwargs: Any) -> Finding:
    return Finding(
        concept=concept,
        label=kwargs.pop("label", concept.replace("_", " ").capitalize()),
        detail=kwargs.pop("detail", f"detail for {concept}"),
        salience=salience,
        **kwargs,
    )


def test_renderer_emits_nothing_when_no_detector_fired() -> None:
    """Not an empty header — a header promising facts with nothing under it is
    worse than silence."""
    assert render_detected_features([]) == ""


def test_renderer_states_its_provenance_in_the_header() -> None:
    text = render_detected_features([_finding("capture", Salience.CRITICAL)])
    assert text.startswith("[DETECTED FEATURES")
    assert "computed from the board, not inferred" in text


def test_renderer_aligns_labels_into_a_column() -> None:
    text = render_detected_features(
        [
            _finding("capture", Salience.CRITICAL, label="Capture", detail="one stone"),
            _finding("atari_ignored", Salience.CRITICAL, label="Atari ignored", detail="still"),
        ]
    )
    lines = [line for line in text.splitlines() if line.startswith("  ")]
    assert lines[0] == "  Capture:          one stone"
    assert lines[1] == "  Atari ignored:    still"
    # Both values begin in the same column regardless of label length.
    assert all(line[19] == " " and line[20] != " " for line in lines)


def test_renderer_hedges_heuristics_and_leaves_exact_findings_flat() -> None:
    """The hedge leads the line, so it is read before the claim it qualifies."""
    text = render_detected_features(
        [
            _finding("capture", Salience.CRITICAL, detail="exact thing"),
            _finding(
                "tenuki", Salience.NOTABLE, detail="fuzzy thing", certainty=Certainty.HEURISTIC
            ),
        ]
    )
    assert 'Lines beginning "estimated —"' in text
    assert "Capture:          exact thing" in text
    assert "Tenuki:           estimated — fuzzy thing" in text


def test_renderer_omits_the_heuristic_note_when_nothing_shown_is_heuristic() -> None:
    text = render_detected_features([_finding("capture", Salience.CRITICAL)])
    assert 'Lines beginning "estimated —"' not in text
    assert "estimated —" not in text


def test_renderer_truncates_from_the_bottom_by_salience() -> None:
    findings = [
        *[_finding(f"crit{i}", Salience.CRITICAL) for i in range(3)],
        *[_finding(f"note{i}", Salience.NOTABLE) for i in range(3)],
        *[_finding(f"bg{i}", Salience.BACKGROUND) for i in range(6)],
    ]
    text = render_detected_features(findings)
    body = [line for line in text.splitlines() if line.startswith("  ")]
    assert len(body) == 8
    for i in range(3):
        assert f"detail for crit{i}" in text
        assert f"detail for note{i}" in text
    # Only the first two background findings survive, in registration order.
    assert "detail for bg0" in text
    assert "detail for bg1" in text
    assert "detail for bg2" not in text


def test_renderer_sorts_unsorted_input_before_truncating() -> None:
    """The renderer does not assume the caller ranked anything."""
    findings = [
        _finding("bg", Salience.BACKGROUND),
        _finding("crit", Salience.CRITICAL),
    ]
    text = render_detected_features(findings, max_lines=1)
    assert "detail for crit" in text
    assert "detail for bg" not in text


def test_renderer_respects_a_custom_cap() -> None:
    findings = [_finding(f"crit{i}", Salience.CRITICAL) for i in range(6)]
    body = [
        line
        for line in render_detected_features(findings, max_lines=5).splitlines()
        if line.startswith("  ")
    ]
    assert len(body) == 5


def test_renderer_rejects_a_nonsensical_cap() -> None:
    with pytest.raises(ValueError, match="max_lines"):
        render_detected_features([_finding("capture", Salience.CRITICAL)], max_lines=0)


def test_renderer_output_for_a_real_move_reads_as_observations() -> None:
    board = board_from_ascii(
        """
        . . . . .
        . . . X .
        . X . O .
        . . . X .
        . . . . .
        """
    )
    text = render_detected_features(run_detectors(_ctx(board, Point(2, 2))))
    assert "Atari given:" in text
    assert "Contact play:" in text
    assert text.endswith("\n")
