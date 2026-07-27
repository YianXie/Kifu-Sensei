"""The pure helpers in ``app.services.katago``.

Most of these convert between three coordinate systems that disagree about which
corner is the origin — sgfmill ``(row, col)`` counting from the bottom-left, KataGo
``"Q4"`` strings skipping the letter ``I``, and the top-row-first display order the
ownership array uses. An off-by-one between any two of them silently produces
commentary about the wrong part of the board, so each conversion is pinned here.
"""

import pytest
from sgfmill import sgf

from app.errors import InvalidSgfError
from app.services.katago import (
    _accumulate_usage,
    _black_winrate_pct,
    _color_letter_to_word,
    _describe_pv_path,
    _display_to_katago_point,
    _empty_usage,
    _extract_komi,
    _extract_rules,
    _generate_ownership_summary,
    _generate_system_prompt,
    _generate_user_prompt,
    _inject_comments_into_sgf,
    _intersection_count_to_point,
    _katago_moves_to_frontend,
    _katago_point_to_display,
    _katago_point_to_sgfmill,
    _mover_winrate_delta,
    _normalize_rules,
    _ordinal,
    _ownership_symbol,
    _prior_descriptor,
    _region_name,
    _render_ownership_map,
    _score_lead,
    _sgfmill_point_to_katago,
    _strength_word,
    sgf_to_winrate_request,
    winrate_request_to_detailed_request,
)

SGF = "(;FF[4]GM[1]SZ[19]KM[6.5]RU[Japanese];B[dd];W[pp];B[];W[dp])"


# ── Coordinate conversion ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("point", "expected"),
    [
        ((0, 0), "A1"),  # bottom-left
        ((18, 0), "A19"),  # top-left
        ((0, 18), "T1"),  # bottom-right
        ((18, 18), "T19"),  # top-right
        ((3, 8), "J4"),  # column 8 is J, because I is skipped
        ((3, 7), "H4"),
    ],
)
def test_sgfmill_to_katago(point: tuple[int, int], expected: str) -> None:
    assert _sgfmill_point_to_katago(point) == expected


def test_katago_columns_skip_the_letter_i() -> None:
    """``I`` is omitted by convention to avoid confusion with ``J`` (and ``1``)."""
    columns = {_sgfmill_point_to_katago((0, col))[0] for col in range(19)}
    assert "I" not in columns
    assert len(columns) == 19


@pytest.mark.parametrize("point", ["A1", "A19", "T1", "T19", "J4", "H4", "Q16"])
def test_katago_to_sgfmill_round_trips(point: str) -> None:
    assert _sgfmill_point_to_katago(_katago_point_to_sgfmill(point)) == point


def test_katago_to_sgfmill_accepts_lowercase() -> None:
    assert _katago_point_to_sgfmill("q4") == _katago_point_to_sgfmill("Q4")


def test_katago_to_sgfmill_rejects_a_pass() -> None:
    """A pass has no coordinates; silently mapping it would place a phantom stone."""
    with pytest.raises(ValueError, match="pass"):
        _katago_point_to_sgfmill("pass")


@pytest.mark.parametrize(
    ("count", "expected"),
    [(1, (18, 0)), (19, (18, 18)), (20, (17, 0)), (361, (0, 18))],
)
def test_render_board_index_maps_to_sgfmill(count: int, expected: tuple[int, int]) -> None:
    """``render_board`` emits the top row first; sgfmill numbers rows from the bottom."""
    assert _intersection_count_to_point(count, 19) == expected


@pytest.mark.parametrize(
    ("point", "expected"), [("A19", (0, 0)), ("A1", (18, 0)), ("T19", (0, 18))]
)
def test_katago_to_display_order(point: str, expected: tuple[int, int]) -> None:
    assert _katago_point_to_display(point, 19) == expected


@pytest.mark.parametrize("point", ["A19", "A1", "T19", "Q16", "D4"])
def test_display_conversion_round_trips(point: str) -> None:
    display_row, col = _katago_point_to_display(point, 19)
    assert _display_to_katago_point(display_row, col, 19) == point


def test_conversions_work_on_a_small_board() -> None:
    assert _sgfmill_point_to_katago((0, 0)) == "A1"
    assert _katago_point_to_display("A9", 9) == (0, 0)
    assert _display_to_katago_point(0, 0, 9) == "A9"


# ── Naming and formatting ─────────────────────────────────────────────────────


def test_current_player_names_the_player_who_just_moved() -> None:
    """``currentPlayer`` is whose turn it *is*, so the mover is the other colour."""
    assert _color_letter_to_word("B") == "White"
    assert _color_letter_to_word("W") == "Black"


@pytest.mark.parametrize(
    ("display_row", "col", "expected"),
    [
        (0, 0, "upper-left"),
        (0, 9, "upper side"),
        (0, 18, "upper-right"),
        (9, 0, "left side"),
        (9, 9, "center"),
        (9, 18, "right side"),
        (18, 0, "lower-left"),
        (18, 9, "lower side"),
        (18, 18, "lower-right"),
    ],
)
def test_region_names_cover_the_whole_board(display_row: int, col: int, expected: str) -> None:
    assert _region_name(display_row, col, 19) == expected


@pytest.mark.parametrize(
    ("n", "expected"),
    [
        (1, "1st"),
        (2, "2nd"),
        (3, "3rd"),
        (4, "4th"),
        (11, "11th"),
        (12, "12th"),
        (13, "13th"),
        (21, "21st"),
        (22, "22nd"),
        (23, "23rd"),
        (101, "101st"),
        (111, "111th"),
        (112, "112th"),
    ],
)
def test_ordinal_handles_the_teens(n: int, expected: str) -> None:
    assert _ordinal(n) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1.0, "B"),
        (0.71, "B"),
        (0.7, "b"),
        (0.31, "b"),
        (0.3, "?"),
        (0.0, "?"),
        (-0.3, "?"),
        (-0.31, "w"),
        (-0.7, "w"),
        (-0.71, "W"),
        (-1.0, "W"),
    ],
)
def test_ownership_symbol_thresholds(value: float, expected: str) -> None:
    assert _ownership_symbol(value) == expected


@pytest.mark.parametrize(
    ("mean", "expected"),
    [
        (0.9, "firmly held"),
        (-0.9, "firmly held"),
        (0.3, "leaning"),
        (-0.3, "leaning"),
        (0.1, "loosely held"),
        (0.0, "loosely held"),
    ],
)
def test_strength_word_is_sign_agnostic(mean: float, expected: str) -> None:
    assert _strength_word(mean) == expected


@pytest.mark.parametrize(
    ("prior", "starts_with"),
    [(0.001, "very low"), (0.03, "low"), (0.1, "moderate"), (0.4, "high")],
)
def test_prior_descriptor_tiers(prior: float, starts_with: str) -> None:
    assert _prior_descriptor(prior).startswith(starts_with)


# ── Win rate and score ────────────────────────────────────────────────────────


def _detail(
    *,
    winrate: float,
    score_lead: float = 0.0,
    current_player: str = "W",
    turn_number: int = 1,
) -> dict:
    return {
        "turnNumber": turn_number,
        "rootInfo": {
            "winrate": winrate,
            "scoreLead": score_lead,
            "currentPlayer": current_player,
        },
    }


def test_black_winrate_is_reported_as_a_rounded_percentage() -> None:
    assert _black_winrate_pct(_detail(winrate=0.62345)) == 62.3


def test_score_lead_is_rounded_to_one_decimal() -> None:
    assert _score_lead(_detail(winrate=0.5, score_lead=3.14159)) == 3.1


def test_a_blunder_by_black_reads_as_a_loss_for_black() -> None:
    """``currentPlayer == "W"`` means Black just moved, so the delta is Black's."""
    delta = _mover_winrate_delta(
        _detail(winrate=0.40, current_player="W"),
        _detail(winrate=0.60, current_player="B"),
    )
    assert delta == -20.0


def test_a_blunder_by_white_reads_as_a_loss_for_white() -> None:
    """White just moved and Black's win rate rose, so White lost ground."""
    delta = _mover_winrate_delta(
        _detail(winrate=0.60, current_player="B"),
        _detail(winrate=0.40, current_player="W"),
    )
    assert delta == -20.0


def test_a_good_move_reads_as_a_gain() -> None:
    delta = _mover_winrate_delta(
        _detail(winrate=0.55, current_player="W"),
        _detail(winrate=0.50, current_player="B"),
    )
    assert delta == 5.0


# ── Principal variation and ownership ─────────────────────────────────────────


def test_pv_path_names_the_regions_it_runs_through() -> None:
    assert _describe_pv_path(["A19", "B19", "C19"], 19) == "upper-left"


def test_pv_path_reports_at_most_two_regions() -> None:
    pv = ["A19", "B19", "T1", "S1", "K10"]
    assert len(_describe_pv_path(pv, 19).split(" / ")) == 2


def test_pv_path_ignores_passes() -> None:
    assert _describe_pv_path(["pass", "A19"], 19) == "upper-left"


def test_pv_path_of_only_passes_is_empty() -> None:
    assert _describe_pv_path(["pass", "pass"], 19) == ""


def test_ownership_map_is_rendered_top_row_first() -> None:
    """Row 19 must come first: KataGo's array is row-major from the top-left."""
    ownership = [1.0] * 19 + [0.0] * (19 * 18)
    lines = _render_ownership_map(ownership, 19).splitlines()

    assert lines[0].split() == list("ABCDEFGHJKLMNOPQRST")
    assert lines[1].startswith("19 ")
    assert lines[1].split()[1:] == ["B"] * 19
    assert lines[-1].startswith(" 1 ")


def test_ownership_map_has_a_line_per_row_plus_a_header() -> None:
    assert len(_render_ownership_map([0.0] * 81, 9).splitlines()) == 10


def test_ownership_summary_names_each_players_strongest_area() -> None:
    # Black owns the top-left ninth outright; White owns the bottom-right ninth.
    ownership = [0.0] * (19 * 19)
    for row in range(6):
        for col in range(6):
            ownership[row * 19 + col] = 1.0
    for row in range(12, 19):
        for col in range(12, 19):
            ownership[row * 19 + col] = -1.0

    summary = _generate_ownership_summary(ownership, 19, played_move="D16", played_color="Black")

    assert "Black's strongest area is the upper-left" in summary
    assert "White's strongest area is the lower-right" in summary
    assert "Black D16 sits in the upper-left" in summary


def test_ownership_summary_reports_an_undecided_board_honestly() -> None:
    summary = _generate_ownership_summary(
        [0.0] * (19 * 19), 19, played_move=None, played_color="Black"
    )
    assert "Black has no clearly consolidated area yet." in summary
    assert "White has no clearly consolidated area yet." in summary
    assert "Still largely undecided" in summary


def test_ownership_summary_omits_the_local_note_for_a_pass() -> None:
    summary = _generate_ownership_summary(
        [0.0] * (19 * 19), 19, played_move="pass", played_color="Black"
    )
    assert "sits in the" not in summary


# ── SGF parsing ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Japanese", "japanese"),
        ("  CHINESE  ", "chinese"),
        ("jp", "japanese"),
        ("NZ", "new-zealand"),
        ("French", "bga"),
        ("Ing", "chinese"),
        ("tromp-taylor", "tromp-taylor"),
    ],
)
def test_known_rulesets_are_normalized_without_a_fallback(raw: str, expected: str) -> None:
    assert _normalize_rules(raw) == (expected, False)


def test_an_unknown_ruleset_falls_back_to_tromp_taylor() -> None:
    assert _normalize_rules("some homebrew ruleset") == ("tromp-taylor", True)


@pytest.mark.parametrize(
    ("sgf_text", "expected"),
    [
        ("(;FF[4]SZ[19]RU[Chinese])", "chinese"),
        ("(;FF[4]SZ[19])", "tromp-taylor"),
        ("(;FF[4]SZ[19]RU[])", "tromp-taylor"),
        ("(;FF[4]SZ[19]RU[  ])", "tromp-taylor"),
    ],
)
def test_extract_rules(sgf_text: str, expected: str) -> None:
    root = sgf.Sgf_game.from_bytes(sgf_text.encode()).get_root()
    assert _extract_rules(root) == expected


@pytest.mark.parametrize(
    ("sgf_text", "expected"),
    [
        ("(;FF[4]SZ[19]KM[6.5])", 6.5),
        ("(;FF[4]SZ[19]KM[0])", 7.5),  # a zero komi is treated as unset
        ("(;FF[4]SZ[19])", 7.5),
        ("(;FF[4]SZ[19]KM[-2.5])", -2.5),
    ],
)
def test_extract_komi(sgf_text: str, expected: float) -> None:
    game = sgf.Sgf_game.from_bytes(sgf_text.encode())
    assert _extract_komi(game) == expected


def test_sgf_to_winrate_request_builds_the_first_pass_payload() -> None:
    request = sgf_to_winrate_request(SGF)

    assert request["boardXSize"] == request["boardYSize"] == 19
    assert request["komi"] == 6.5
    assert request["rules"] == "japanese"
    assert request["moves"] == [["B", "D16"], ["W", "Q4"], ["B", "pass"], ["W", "D4"]]
    assert request["initialStones"] == []
    # Turn 0 is the empty board, through to the position after the last move.
    assert request["analyzeTurns"] == [0, 1, 2, 3, 4]
    assert request["maxVisits"] == 50
    assert request["includeOwnership"] is False
    assert request["includePolicy"] is False


def test_sgf_to_winrate_request_keeps_handicap_stones_out_of_the_move_list() -> None:
    """Handicap stones are setup, not moves; counting them would shift every turn."""
    handicap = "(;FF[4]GM[1]SZ[19]HA[2]AB[dd][pp];W[dp])"
    request = sgf_to_winrate_request(handicap)

    # Sorted by sgfmill ``(row, col)``, so the lower stone comes first.
    assert request["initialStones"] == [["B", "Q4"], ["B", "D16"]]
    assert request["moves"] == [["W", "D4"]]
    assert request["analyzeTurns"] == [0, 1]


def test_sgf_to_winrate_request_supports_non_square_board_sizes() -> None:
    request = sgf_to_winrate_request("(;FF[4]GM[1]SZ[9];B[cc])")
    assert request["boardXSize"] == 9
    assert request["moves"] == [["B", "C7"]]


@pytest.mark.parametrize("bad_sgf", ["not an sgf at all", "", "(;FF[4]SZ[19]", "(;B[dd]"])
def test_an_unparseable_sgf_raises_a_typed_error(bad_sgf: str) -> None:
    """A typed error, not a bare ``ValueError``: the coordinate helpers raise
    ``ValueError`` for genuine bugs, and the router must not confuse the two."""
    with pytest.raises(InvalidSgfError):
        sgf_to_winrate_request(bad_sgf)


def test_the_detailed_request_deepens_the_analysis() -> None:
    first_pass = sgf_to_winrate_request(SGF)
    detailed = winrate_request_to_detailed_request(first_pass, [2, 4])

    assert detailed["analyzeTurns"] == [2, 4]
    assert detailed["maxVisits"] == 500
    assert detailed["analysisPVLen"] == 15
    assert detailed["includeOwnership"] is True
    assert detailed["includePolicy"] is True
    assert detailed["overrideSettings"]["wideRootNoise"] == 0.04


def test_the_detailed_request_does_not_mutate_the_first_pass_request() -> None:
    """Both detailed requests are derived from the same first-pass payload, so a
    shallow copy would let one leak its ``analyzeTurns`` into the other."""
    first_pass = sgf_to_winrate_request(SGF)
    winrate_request_to_detailed_request(first_pass, [2])

    assert first_pass["maxVisits"] == 50
    assert first_pass["analyzeTurns"] == [0, 1, 2, 3, 4]
    assert first_pass["overrideSettings"]["wideRootNoise"] == 0.0


# ── Frontend conversion and SGF annotation ────────────────────────────────────


def test_moves_are_converted_to_frontend_coordinates() -> None:
    moves, initial = _katago_moves_to_frontend([["B", "D16"], ["W", "pass"]], [["B", "Q4"]])
    assert moves == [["B", [15, 3]], ["W", None]]
    assert initial == [["B", [3, 15]]]


def test_a_pass_becomes_a_null_point() -> None:
    moves, _ = _katago_moves_to_frontend([["B", "pass"]], [])
    assert moves == [["B", None]]


def test_comments_are_injected_at_the_right_moves() -> None:
    annotated = _inject_comments_into_sgf(
        SGF, [{"turn": 1, "comment": "First move."}, {"turn": 4, "comment": "Last move."}]
    )
    game = sgf.Sgf_game.from_bytes(annotated.encode(), override_encoding="utf-8")
    nodes = game.get_main_sequence()

    assert nodes[1].get("C") == "First move."
    assert nodes[4].get("C") == "Last move."
    assert not nodes[2].has_property("C")


def test_injection_escapes_sgf_metacharacters() -> None:
    """An unescaped ``]`` would truncate the property and corrupt the file."""
    comment = "Consider A[1] — or B\\C]"
    annotated = _inject_comments_into_sgf(SGF, [{"turn": 1, "comment": comment}])

    game = sgf.Sgf_game.from_bytes(annotated.encode(), override_encoding="utf-8")
    assert game.get_main_sequence()[1].get("C") == comment


def test_injection_preserves_non_latin1_characters() -> None:
    """Commentary can be Japanese or contain em dashes; a latin-1 presenter would
    fail to serialise either."""
    comment = "この手は緩手です — 白が有利。"
    annotated = _inject_comments_into_sgf(SGF, [{"turn": 1, "comment": comment}])

    game = sgf.Sgf_game.from_bytes(annotated.encode(), override_encoding="utf-8")
    assert game.get_main_sequence()[1].get("C") == comment


def test_injection_with_no_comments_leaves_the_moves_intact() -> None:
    annotated = _inject_comments_into_sgf(SGF, [])
    game = sgf.Sgf_game.from_bytes(annotated.encode(), override_encoding="utf-8")

    assert len(game.get_main_sequence()) == 5
    assert not game.get_main_sequence()[1].has_property("C")


def test_injection_rejects_an_unparseable_sgf() -> None:
    with pytest.raises(InvalidSgfError):
        _inject_comments_into_sgf("nonsense", [])


# ── Token usage ───────────────────────────────────────────────────────────────


class _Usage:
    def __init__(self, **kwargs) -> None:
        self.__dict__.update(kwargs)


def test_empty_usage_starts_at_zero() -> None:
    assert _empty_usage() == {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }


def test_usage_accumulates_across_calls() -> None:
    totals = _empty_usage()
    _accumulate_usage(totals, _Usage(input_tokens=10, output_tokens=3))
    _accumulate_usage(totals, _Usage(input_tokens=7, output_tokens=2))

    assert totals["input_tokens"] == 17
    assert totals["output_tokens"] == 5


def test_null_cache_counters_are_treated_as_zero() -> None:
    """The SDK reports ``None``, not ``0``, when prompt caching is not in play."""
    totals = _empty_usage()
    _accumulate_usage(
        totals,
        _Usage(
            input_tokens=5,
            output_tokens=1,
            cache_read_input_tokens=None,
            cache_creation_input_tokens=None,
        ),
    )
    assert totals["cache_read_input_tokens"] == 0
    assert totals["cache_creation_input_tokens"] == 0


def test_missing_usage_attributes_are_tolerated() -> None:
    """Guards against an SDK version that drops an attribute entirely."""
    totals = _empty_usage()
    _accumulate_usage(totals, _Usage())
    assert totals == _empty_usage()


# ── Prompts ───────────────────────────────────────────────────────────────────


def test_the_system_prompt_requests_the_configured_language() -> None:
    assert "Always respond in japanese." in _generate_system_prompt(language="japanese")


def test_a_custom_instruction_is_appended_and_subordinated() -> None:
    prompt = _generate_system_prompt(custom_instruction="Mention joseki names.")
    assert "Mention joseki names." in prompt
    assert "where they do not conflict with the rules above" in prompt


def test_a_blank_custom_instruction_adds_no_section() -> None:
    assert "Additional instructions" not in _generate_system_prompt(custom_instruction="   ")


def _prompt_fixture(*, with_ownership: bool = True) -> str:
    request = sgf_to_winrate_request(SGF)
    detail = {
        "turnNumber": 2,
        "rootInfo": {"winrate": 0.42, "scoreLead": -4.5, "currentPlayer": "B"},
        "moveInfos": [],
    }
    if with_ownership:
        detail["ownership"] = [0.0] * (19 * 19)
    prev_detail = {
        "turnNumber": 1,
        "rootInfo": {"winrate": 0.50, "scoreLead": 0.5, "currentPlayer": "W"},
        "moveInfos": [
            {
                "move": "Q16",
                "order": 0,
                "prior": 0.25,
                "winrate": 0.55,
                "scoreLead": 2.0,
                "pv": ["Q16", "D4", "Q4"],
            },
            {
                "move": "Q4",
                "order": 3,
                "prior": 0.01,
                "winrate": 0.42,
                "scoreLead": -4.0,
                "pv": ["Q4"],
            },
        ],
    }
    return _generate_user_prompt(
        detail,
        prev_detail,
        board_size=request["boardXSize"],
        komi=request["komi"],
        rules=request["rules"],
        initial_stones=request["initialStones"],
        moves=request["moves"],
    )


def test_the_user_prompt_names_the_player_who_moved() -> None:
    """Turn 2 is White's move here, and ``currentPlayer`` is Black."""
    prompt = _prompt_fixture()
    assert "Move 2. White just played." in prompt


def test_the_user_prompt_states_the_game_setup() -> None:
    assert "19*19, komi 6.5, japanese rules" in _prompt_fixture()


def test_the_user_prompt_marks_the_played_move_and_the_suggestion() -> None:
    prompt = _prompt_fixture()
    assert "★ = the move White just played (Q4)" in prompt
    assert "* = KataGo's top suggestion (Q16)" in prompt
    assert "★" in prompt.split("[BOARD POSITION")[1]


def test_the_user_prompt_reports_the_winrate_change_from_the_movers_side() -> None:
    """Black is on 42%, so White is on 58% — up from 50% before the move."""
    prompt = _prompt_fixture()
    assert "[CHANGE: +8.0%]" in prompt


def test_the_user_prompt_ranks_the_played_move_when_katago_considered_it() -> None:
    prompt = _prompt_fixture()
    assert "4th best move (order: 3)" in prompt
    assert "Policy prior: 0.010" in prompt


def test_the_user_prompt_says_so_when_the_move_was_not_a_candidate() -> None:
    request = sgf_to_winrate_request(SGF)
    prev_detail = {
        "turnNumber": 1,
        "rootInfo": {"winrate": 0.5, "scoreLead": 0.0, "currentPlayer": "W"},
        "moveInfos": [{"move": "Q16", "order": 0, "prior": 0.3, "winrate": 0.55, "scoreLead": 2.0}],
    }
    prompt = _generate_user_prompt(
        {
            "turnNumber": 2,
            "rootInfo": {"winrate": 0.4, "scoreLead": -3.0, "currentPlayer": "B"},
            "moveInfos": [],
        },
        prev_detail,
        board_size=19,
        komi=request["komi"],
        rules=request["rules"],
        initial_stones=[],
        moves=request["moves"],
    )
    assert "This move was not among KataGo's analyzed candidate moves." in prompt


def test_the_user_prompt_includes_the_ownership_section_when_available() -> None:
    prompt = _prompt_fixture(with_ownership=True)
    assert "[OWNERSHIP MAP" in prompt
    assert "Ownership summary (derived):" in prompt


def test_the_user_prompt_omits_the_ownership_section_when_absent() -> None:
    prompt = _prompt_fixture(with_ownership=False)
    assert "[OWNERSHIP MAP" not in prompt


def test_the_user_prompt_describes_the_principal_variation() -> None:
    prompt = _prompt_fixture()
    assert "Principal variation: Q16 → D4 → Q4 ..." in prompt
    assert "Sequence runs 3 moves deep" in prompt
