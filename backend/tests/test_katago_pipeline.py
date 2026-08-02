"""``generate_commentary`` end to end, with both upstreams faked.

KataGo is served through ``respx`` and Anthropic through a stub client, so this
covers the parts that only appear when the whole pipeline runs: which moves get
selected for the detailed pass, that each prompt is paired with the right previous
position, and the shape of the returned payload.
"""

import json
import logging
from typing import Any

import anthropic
import httpx
import pytest
import respx

from app.crypto import encrypt_secret
from app.errors import MissingApiKeyError
from app.models import User
from app.services import katago as katago_service
from app.services.katago import generate_commentary, generate_commentary_with_claude

SGF = "(;FF[4]GM[1]SZ[19]KM[6.5]RU[Chinese];B[dd];W[pp];B[dp];W[pd])"

# Win rate is always Black's. ``currentPlayer`` is whoever is to move next, so a
# result tagged "W" describes the position after Black played.
#
#   turn 1: Black drops 20 points of win rate  -> worst
#   turn 2: White gives 10 back                -> second worst
#   turns 3 and 4: near-neutral                -> not selected when num_comments=2
WINRATE_RESULTS = [
    {"turnNumber": 0, "rootInfo": {"winrate": 0.50, "scoreLead": 0.0, "currentPlayer": "B"}},
    {"turnNumber": 1, "rootInfo": {"winrate": 0.30, "scoreLead": -6.0, "currentPlayer": "W"}},
    {"turnNumber": 2, "rootInfo": {"winrate": 0.40, "scoreLead": -2.0, "currentPlayer": "B"}},
    {"turnNumber": 3, "rootInfo": {"winrate": 0.42, "scoreLead": -1.5, "currentPlayer": "W"}},
    {"turnNumber": 4, "rootInfo": {"winrate": 0.41, "scoreLead": -1.8, "currentPlayer": "B"}},
]


def _move_infos(top: str) -> list[dict[str, Any]]:
    return [
        {
            "move": top,
            "order": 0,
            "prior": 0.22,
            "winrate": 0.55,
            "scoreLead": 2.0,
            "pv": [top, "D4", "Q4"],
        },
        {
            "move": "Q4",
            "order": 2,
            "prior": 0.03,
            "winrate": 0.40,
            "scoreLead": -3.0,
            "pv": ["Q4"],
        },
    ]


DETAILED_RESULTS: dict[int, dict[str, Any]] = {
    turn: {
        **result,
        "moveInfos": _move_infos("Q16"),
        "ownership": [0.0] * (19 * 19),
    }
    for turn, result in enumerate(WINRATE_RESULTS)
}


class _FakeBlock:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class _FakeUsage:
    input_tokens = 100
    output_tokens = 40
    cache_read_input_tokens = None
    cache_creation_input_tokens = None


class _FakeMessage:
    def __init__(self, text: str) -> None:
        self.content = [_FakeBlock(text)]
        self.usage = _FakeUsage()


class _FakeAnthropic:
    """Stand-in for ``anthropic.Anthropic`` that records every call."""

    instances: list["_FakeAnthropic"] = []

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.calls: list[dict[str, Any]] = []
        self.messages = self
        _FakeAnthropic.instances.append(self)

    def create(self, **kwargs) -> _FakeMessage:
        self.calls.append(kwargs)
        return _FakeMessage(f"Comment #{len(self.calls)}")


@pytest.fixture
def fake_anthropic(monkeypatch: pytest.MonkeyPatch):
    _FakeAnthropic.instances = []
    monkeypatch.setattr(katago_service, "Anthropic", _FakeAnthropic)
    return _FakeAnthropic


class _FlakyFakeAnthropic(_FakeAnthropic):
    """Like ``_FakeAnthropic``, but raises on specific 1-based call numbers."""

    fail_on: set[int] = set()

    def create(self, **kwargs) -> _FakeMessage:
        call_number = len(self.calls) + 1
        self.calls.append(kwargs)
        if call_number in self.fail_on:
            request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.APIConnectionError(request=request)
        return _FakeMessage(f"Comment #{call_number}")


@pytest.fixture
def flaky_fake_anthropic(monkeypatch: pytest.MonkeyPatch):
    """Returns a factory: ``flaky_fake_anthropic({1, 3})`` fails calls 1 and 3."""

    def _install(fail_on: set[int]) -> type[_FlakyFakeAnthropic]:
        _FlakyFakeAnthropic.instances = []
        _FlakyFakeAnthropic.fail_on = fail_on
        monkeypatch.setattr(katago_service, "Anthropic", _FlakyFakeAnthropic)
        return _FlakyFakeAnthropic

    return _install


@pytest.fixture
def katago_requests():
    """Serve the KataGo analysis engine, recording every request body.

    Results come back in reverse turn order so that a missing ``sorted`` in the
    pipeline would pair each prompt with the wrong previous position.
    """
    recorded: list[dict[str, Any]] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        recorded.append(body)
        if body["maxVisits"] == 50:
            return httpx.Response(200, json=list(reversed(WINRATE_RESULTS)))
        turns = body["analyzeTurns"]
        return httpx.Response(200, json=[DETAILED_RESULTS[turn] for turn in reversed(turns)])

    # ``assert_all_called=False``: several tests below assert that the pipeline
    # bails out *before* it ever reaches KataGo.
    with respx.mock(base_url="http://katago.invalid", assert_all_called=False) as router:
        router.post("/analyze").mock(side_effect=_handler)
        yield recorded


@pytest.fixture
def keyed_user(make_user) -> User:
    return make_user(claude_api=encrypt_secret("sk-ant-api03-not-a-real-key"))


def _run(user: User, **overrides) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"sgf_file_name": "game.sgf", "num_comments": 2}
    kwargs.update(overrides)
    return generate_commentary(SGF, user, **kwargs)


# ── Move selection ────────────────────────────────────────────────────────────


def test_the_worst_moves_are_chosen_for_the_detailed_pass(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    _run(keyed_user)

    first_pass, detailed, detailed_prev = katago_requests
    assert first_pass["maxVisits"] == 50
    assert detailed["analyzeTurns"] == [1, 2]
    assert detailed_prev["analyzeTurns"] == [0, 1]


def test_num_comments_caps_how_many_moves_are_analysed(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    _run(keyed_user, num_comments=1)
    assert katago_requests[1]["analyzeTurns"] == [1]


def test_asking_for_more_comments_than_there_are_moves_is_not_an_error(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    """A short game yields fewer comments than requested rather than failing."""
    result = _run(keyed_user, num_comments=50)
    assert len(result["comments"]) == 4


def test_the_detailed_passes_ask_for_ownership_and_policy(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    _run(keyed_user)

    detailed_passes = [r for r in katago_requests if r["maxVisits"] == 500]
    assert len(detailed_passes) == 2
    for request in detailed_passes:
        assert request["includeOwnership"] is True
        assert request["includePolicy"] is True
        assert request["analysisPVLen"] == 15


# ── Result payload ────────────────────────────────────────────────────────────


def test_the_result_carries_one_comment_per_selected_move(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    result = _run(keyed_user)

    assert [item["turn"] for item in result["comments"]] == [1, 2]
    assert [item["comment"] for item in result["comments"]] == ["Comment #1", "Comment #2"]


def test_each_comment_records_the_colour_that_played_it(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    """Read from the move list, not from turn parity — handicap games open with White."""
    result = _run(keyed_user)
    assert [item["color"] for item in result["comments"]] == ["B", "W"]


def test_the_winrate_delta_is_reported_from_the_movers_side(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    result = _run(keyed_user)

    # Turn 1: Black went 50% -> 30%.
    assert result["comments"][0]["winrate_delta"] == -20.0
    # Turn 2: White went 70% -> 60% (Black's 30% and 40%, mirrored).
    assert result["comments"][1]["winrate_delta"] == -10.0


def test_the_result_reports_the_board_and_request_metadata(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    result = _run(keyed_user, model="claude-opus-5", language="korean")

    assert result["board_size"] == 19
    assert result["sgf_file_name"] == "game.sgf"
    assert result["language"] == "korean"
    assert result["model"] == "claude-opus-5"


def test_moves_are_returned_in_frontend_coordinates(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    result = _run(keyed_user)
    assert result["moves"] == [
        ["B", [15, 3]],
        ["W", [3, 15]],
        ["B", [3, 3]],
        ["W", [15, 15]],
    ]
    assert result["initial_stones"] == []


def test_token_usage_is_summed_across_every_call(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    result = _run(keyed_user)
    assert result["usage"] == {
        "input_tokens": 200,
        "output_tokens": 80,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }


def test_the_annotated_sgf_carries_the_commentary(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    from sgfmill import sgf

    result = _run(keyed_user)
    game = sgf.Sgf_game.from_bytes(
        result["annotated_sgf_content"].encode(), override_encoding="utf-8"
    )
    nodes = game.get_main_sequence()

    assert nodes[1].get("C") == "Comment #1"
    assert nodes[2].get("C") == "Comment #2"
    assert not nodes[3].has_property("C")


# ── Claude call ───────────────────────────────────────────────────────────────


def test_the_stored_key_is_decrypted_for_the_call(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    _run(keyed_user)
    assert fake_anthropic.instances[0].api_key == "sk-ant-api03-not-a-real-key"


def test_the_configured_model_and_token_cap_are_passed_through(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    _run(keyed_user, model="claude-haiku-4-5", max_token=512)

    call = fake_anthropic.instances[0].calls[0]
    assert call["model"] == "claude-haiku-4-5"
    assert call["max_tokens"] == 512


def test_the_custom_instruction_reaches_the_system_prompt(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    _run(keyed_user, custom_instruction="Mention joseki names.")
    assert "Mention joseki names." in fake_anthropic.instances[0].calls[0]["system"]


def test_each_prompt_describes_its_own_move(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    """Guards the pairing of ``detailed_results[i]`` with ``detailed_prev_results[i]``
    — both lists are sorted before use, and the fake returns them reversed."""
    _run(keyed_user)

    prompts = [call["messages"][0]["content"] for call in fake_anthropic.instances[0].calls]
    assert "Move 1. Black just played." in prompts[0]
    assert "Move 2. White just played." in prompts[1]


def test_progress_is_published_before_and_after_each_comment(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    """Published up front so a poller shows "0 of 2" instead of "0 of 0"."""
    seen: list[tuple[int, int]] = []
    _run(keyed_user, on_progress=lambda done, total: seen.append((done, total)))

    assert seen == [(0, 2), (1, 2), (2, 2)]


# ── Failure modes ─────────────────────────────────────────────────────────────


def test_a_user_without_a_key_fails_before_katago_is_called(
    user: User, katago_requests, fake_anthropic
) -> None:
    """The KataGo passes take minutes; spending them for a run that cannot finish
    would waste the engine's time."""
    with pytest.raises(MissingApiKeyError):
        _run(user)

    assert katago_requests == []


def test_generate_commentary_with_claude_also_checks_for_a_key(user: User) -> None:
    """It is callable on its own, so it cannot rely on the caller's check."""
    with pytest.raises(MissingApiKeyError):
        generate_commentary_with_claude(user, ["a prompt"])


def test_a_katago_error_propagates_as_an_http_error(keyed_user: User, fake_anthropic) -> None:
    """The router turns this into ``katago_unavailable``."""
    with respx.mock(base_url="http://katago.invalid", assert_all_called=False) as router:
        router.post("/analyze").mock(return_value=httpx.Response(503))
        with pytest.raises(httpx.HTTPStatusError):
            _run(keyed_user)


def test_katago_being_unreachable_propagates_as_a_transport_error(
    keyed_user: User, fake_anthropic
) -> None:
    with respx.mock(base_url="http://katago.invalid", assert_all_called=False) as router:
        router.post("/analyze").mock(side_effect=httpx.ConnectError("refused"))
        with pytest.raises(httpx.ConnectError):
            _run(keyed_user)


def test_no_claude_call_is_made_when_katago_fails(keyed_user: User, fake_anthropic) -> None:
    with respx.mock(base_url="http://katago.invalid", assert_all_called=False) as router:
        router.post("/analyze").mock(return_value=httpx.Response(500))
        with pytest.raises(httpx.HTTPStatusError):
            _run(keyed_user)

    assert fake_anthropic.instances == []


def test_an_unparseable_sgf_fails_before_katago_is_called(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    from app.errors import InvalidSgfError

    with pytest.raises(InvalidSgfError):
        generate_commentary("not an sgf", keyed_user, sgf_file_name="bad.sgf")

    assert katago_requests == []


def test_an_sgf_without_moves_fails_before_katago_is_called(
    keyed_user: User, katago_requests, fake_anthropic
) -> None:
    """A position diagram parses cleanly but has nothing to comment on."""
    from app.errors import InvalidSgfError

    with pytest.raises(InvalidSgfError):
        generate_commentary(
            "(;FF[4]GM[1]SZ[19]KM[7.5]AB[dd][pp]AW[dp][pd])",
            keyed_user,
            sgf_file_name="diagram.sgf",
        )

    assert katago_requests == []


def test_a_katago_rejection_logs_the_upstream_body(
    keyed_user: User, fake_anthropic, caplog
) -> None:
    """The status alone cannot say which field the engine objected to."""
    with respx.mock(base_url="http://katago.invalid", assert_all_called=False) as router:
        router.post("/analyze").mock(
            return_value=httpx.Response(
                422, json={"detail": [{"loc": ["body", "komi"], "msg": "not a valid float"}]}
            )
        )
        with caplog.at_level(logging.ERROR, logger="katago-service-logger"):
            with pytest.raises(httpx.HTTPStatusError):
                _run(keyed_user)

    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "not a valid float" in logged
    assert "422" in logged


def test_one_failed_call_leaves_a_placeholder_but_keeps_the_rest(
    keyed_user: User, katago_requests, flaky_fake_anthropic, caplog
) -> None:
    """Regression test: a single Anthropic call failing (after the SDK's own retries
    already gave up) used to discard every comment already generated in the run —
    including ones already paid for — rather than losing just the one."""
    flaky_fake_anthropic({1})

    with caplog.at_level(logging.WARNING, logger="katago-service-logger"):
        result = _run(keyed_user)

    comments = {c["turn"]: c["comment"] for c in result["comments"]}
    assert len(comments) == 2
    assert "could not be generated" in comments[1]
    assert comments[2] == "Comment #2"
    assert any("Anthropic call failed" in record.getMessage() for record in caplog.records)


def test_a_placeholder_comment_still_reaches_the_annotated_sgf(
    keyed_user: User, katago_requests, flaky_fake_anthropic
) -> None:
    flaky_fake_anthropic({1})
    result = _run(keyed_user)
    assert "could not be generated" in result["annotated_sgf_content"]


def test_token_usage_only_counts_the_calls_that_succeeded(
    keyed_user: User, katago_requests, flaky_fake_anthropic
) -> None:
    flaky_fake_anthropic({1})
    result = _run(keyed_user)
    # _FakeUsage reports 100 input / 40 output tokens per successful call; only one
    # of the two calls succeeded.
    assert result["usage"]["input_tokens"] == 100
    assert result["usage"]["output_tokens"] == 40


def test_progress_still_advances_past_a_failed_call(
    keyed_user: User, katago_requests, flaky_fake_anthropic
) -> None:
    flaky_fake_anthropic({1})
    seen: list[tuple[int, int]] = []
    _run(keyed_user, on_progress=lambda done, total: seen.append((done, total)))
    assert seen == [(0, 2), (1, 2), (2, 2)]


def test_when_every_call_fails_the_original_error_propagates(
    keyed_user: User, katago_requests, flaky_fake_anthropic
) -> None:
    """A run where nothing succeeded must fail outright — reporting it as a
    successful job made entirely of placeholders would be worse than raising."""
    flaky_fake_anthropic({1, 2})

    with pytest.raises(anthropic.APIConnectionError):
        _run(keyed_user)


def test_generate_commentary_with_claude_raises_when_the_only_prompt_fails(
    keyed_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Called directly rather than through the full pipeline, with a single prompt."""

    class _AlwaysFails:
        def __init__(self, api_key: str) -> None:
            self.messages = self

        def create(self, **kwargs):
            request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.APIConnectionError(request=request)

    monkeypatch.setattr(katago_service, "Anthropic", _AlwaysFails)

    with pytest.raises(anthropic.APIConnectionError):
        generate_commentary_with_claude(keyed_user, ["a prompt"])


# ── HTTP client lifecycle ─────────────────────────────────────────────────────


def test_the_http_client_is_reused_between_calls() -> None:
    katago_service.close_http_client()
    first = katago_service.get_http_client()
    assert katago_service.get_http_client() is first


def test_a_closed_http_client_is_replaced() -> None:
    """The lifespan closes it on shutdown; a later call must not reuse the corpse."""
    first = katago_service.get_http_client()
    katago_service.close_http_client()
    assert katago_service.get_http_client() is not first


def test_closing_twice_is_safe() -> None:
    katago_service.get_http_client()
    katago_service.close_http_client()
    katago_service.close_http_client()


# ── Logging ───────────────────────────────────────────────────────────────────


def test_the_file_handler_rotates_instead_of_growing_without_bound() -> None:
    from logging.handlers import RotatingFileHandler

    file_handlers = [
        h for h in katago_service.logger.handlers if isinstance(h, RotatingFileHandler)
    ]
    assert len(file_handlers) == 1
    assert file_handlers[0].maxBytes > 0
    assert file_handlers[0].backupCount > 0


def test_the_per_move_prompt_is_logged_at_debug_not_info(
    keyed_user: User, katago_requests, fake_anthropic, caplog: pytest.LogCaptureFixture
) -> None:
    """INFO is what a hosted platform typically ships to a log aggregator — the full
    prompt (ASCII board, ownership map) has no business going there on every move of
    every run."""
    with caplog.at_level(logging.INFO, logger="katago-service-logger"):
        _run(keyed_user)
    assert not any("User prompt for move" in r.getMessage() for r in caplog.records)

    caplog.clear()
    with caplog.at_level(logging.DEBUG, logger="katago-service-logger"):
        _run(keyed_user)
    assert any("User prompt for move" in r.getMessage() for r in caplog.records)
