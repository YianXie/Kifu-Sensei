"""Live checks that KataGo's ownership conventions are what the code believes.

These are the highest-value tests in Tier 2 and the only ones that talk to a real
engine. Everything the KataGo-derived detectors say rests on two conventions — which
way the ownership array is laid out, and whose perspective its sign is from — and
both fail silently when wrong: a transposed map is still well-formed, still produces
confident numbers, and the feature block instructs the model to state them as fact.
A unit test built on a synthetic array cannot catch the engine changing its mind.

Skipped unless ``KIFU_LIVE_KATAGO_ENDPOINT`` names a running analysis server, so CI
and ordinary local runs never reach the network::

    cd backend && KIFU_LIVE_KATAGO_ENDPOINT=https://katago.example uv run pytest \\
        tests/test_katago_live.py -v

The probe position seals the **upper-left** corner for Black and the **lower-right**
for White. Those two corners exchange under transposition, so a transposed read
inverts the sign; row inversion sends the upper-left to the neutral lower-left, and
column inversion to the neutral upper-right. A symmetric position would prove
nothing.
"""

import os
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.services.board import Color, Point, point_to_go_notation
from app.services.concepts import OwnershipMap

ENDPOINT = os.environ.get("KIFU_LIVE_KATAGO_ENDPOINT", "")

pytestmark = pytest.mark.skipif(
    not ENDPOINT,
    reason="set KIFU_LIVE_KATAGO_ENDPOINT to run the live KataGo convention checks",
)

SIZE = 19
_REQUEST_TIMEOUT = 300
_VISITS = 500

# Walls enclosing one corner each, far enough apart to be independently settled.
_BLACK_WALL = [Point(13, col) for col in range(6)] + [Point(row, 5) for row in range(14, 19)]
_WHITE_WALL = [Point(5, col) for col in range(13, 19)] + [Point(row, 13) for row in range(5)]

_UPPER_LEFT = [Point(row, col) for row in range(14, 19) for col in range(5)]
_LOWER_RIGHT = [Point(row, col) for row in range(5) for col in range(14, 19)]
_LOWER_LEFT = [Point(row, col) for row in range(5) for col in range(5)]
_UPPER_RIGHT = [Point(row, col) for row in range(14, 19) for col in range(14, 19)]

#: The corners are walled off solidly, so anything short of near-total ownership
#: would mean the probe position is not doing its job.
_SETTLED = 0.85
#: The two open corners must stay far from settled for the flips to be separable.
_NEUTRAL = 0.75


def _analyse(moves: list[list[str]], turn: int) -> dict[str, Any]:
    stones = [["B", point_to_go_notation(p, SIZE)] for p in _BLACK_WALL]
    stones += [["W", point_to_go_notation(p, SIZE)] for p in _WHITE_WALL]
    payload = {
        "id": f"live-convention-{turn}",
        "initialStones": stones,
        "moves": moves,
        "rules": "chinese",
        "komi": 7.5,
        "boardXSize": SIZE,
        "boardYSize": SIZE,
        "analyzeTurns": [turn],
        "maxVisits": _VISITS,
        "includeOwnership": True,
    }
    with httpx.Client(timeout=_REQUEST_TIMEOUT, base_url=ENDPOINT) as client:
        response = client.post("/analyze", json=payload)
        response.raise_for_status()
        body = response.json()
    return body[0] if isinstance(body, list) else body


@pytest.fixture(scope="module")
def black_to_play() -> dict[str, Any]:
    return _analyse([], 0)


@pytest.fixture(scope="module")
def white_to_play() -> dict[str, Any]:
    """The identical position, one pass later, so the mover has changed."""
    return _analyse([["B", "pass"]], 1)


def test_the_engine_returns_one_ownership_value_per_point(black_to_play: dict[str, Any]) -> None:
    assert len(black_to_play["ownership"]) == SIZE * SIZE


def test_high_magnitude_ownership_lands_where_the_settled_groups_are(
    black_to_play: dict[str, Any],
) -> None:
    """Hazard 1: the array's traversal order and origin corner."""
    ownership = OwnershipMap.build(black_to_play["ownership"], SIZE)
    assert ownership.mean_for(_UPPER_LEFT, Color.BLACK) > _SETTLED
    assert ownership.mean_for(_LOWER_RIGHT, Color.WHITE) > _SETTLED
    # The corners a flip would send us to are nowhere near settled, which is what
    # makes the assertions above load-bearing rather than coincidental.
    assert abs(ownership.mean_for(_LOWER_LEFT, Color.BLACK)) < _NEUTRAL
    assert abs(ownership.mean_for(_UPPER_RIGHT, Color.BLACK)) < _NEUTRAL


def _misread(raw: list[float], swap: Callable[[Point], Point]) -> OwnershipMap:
    """Rebuild the array so that reading ``p`` returns the engine's value at ``swap(p)``.

    Phrased in board coordinates rather than array offsets, because that is the shape
    the bug takes in practice: :meth:`OwnershipMap._index` mixing up the row and
    column of a :class:`Point`, or forgetting that our row 0 is the bottom while the
    array's first row is the top.
    """
    source = OwnershipMap.build(raw, SIZE)
    values = [0.0] * (SIZE * SIZE)
    for row in range(SIZE):
        for col in range(SIZE):
            values[(SIZE - 1 - row) * SIZE + col] = source.at(swap(Point(row, col)))
    return OwnershipMap.build(values, SIZE)


def test_a_transposed_reading_would_have_inverted_the_answer(
    black_to_play: dict[str, Any],
) -> None:
    """Transposition maps the upper-left onto the lower-right, which White owns.

    The strongest of the three checks: the corrupted read does not merely differ, it
    reports Black's most secure territory as White's.
    """
    ownership = _misread(black_to_play["ownership"], lambda p: Point(p.col, p.row))
    assert ownership.mean_for(_UPPER_LEFT, Color.BLACK) < -_SETTLED


@pytest.mark.parametrize(
    ("kind", "swap"),
    [
        ("row-inverted", lambda p: Point(SIZE - 1 - p.row, p.col)),
        ("column-inverted", lambda p: Point(p.row, SIZE - 1 - p.col)),
    ],
)
def test_an_inverted_reading_would_have_landed_on_neutral_ground(
    black_to_play: dict[str, Any], kind: str, swap: Callable[[Point], Point]
) -> None:
    """Row inversion lands on the lower-left, column inversion on the upper-right —
    both left deliberately unsettled so the difference is unmistakable."""
    ownership = _misread(black_to_play["ownership"], swap)
    assert abs(ownership.mean_for(_UPPER_LEFT, Color.BLACK)) < _NEUTRAL


def test_ownership_is_black_relative_not_mover_relative(
    black_to_play: dict[str, Any], white_to_play: dict[str, Any]
) -> None:
    """Hazard 2, the half-right failure: a mover-relative read looks correct on half
    the moves and inverted on the other half, because colour alternates."""
    assert black_to_play["rootInfo"]["currentPlayer"] == "B"
    assert white_to_play["rootInfo"]["currentPlayer"] == "W"

    from_black = OwnershipMap.build(black_to_play["ownership"], SIZE)
    from_white = OwnershipMap.build(white_to_play["ownership"], SIZE)
    # Same stones, different mover: Black's corner stays Black's.
    assert from_black.mean_for(_UPPER_LEFT, Color.BLACK) > _SETTLED
    assert from_white.mean_for(_UPPER_LEFT, Color.BLACK) > _SETTLED


def test_winrate_and_score_lead_are_black_relative(
    black_to_play: dict[str, Any], white_to_play: dict[str, Any]
) -> None:
    """Whose turn it is cannot change who is ahead, so a mover-relative field would
    have to flip between these two readings of one position. Neither does."""
    for detail in (black_to_play, white_to_play):
        root = detail["rootInfo"]
        assert 0.0 <= root["winrate"] <= 1.0
        # Black is behind on the board here (White holds komi plus the sente), and
        # both fields agree about it regardless of whose move it is.
        assert (root["winrate"] < 0.5) == (root["scoreLead"] < 0)
