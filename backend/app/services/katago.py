import copy
import logging
from typing import Any

import httpx
from sgfmill import sgf

from app.config import settings

logger = logging.getLogger(__name__)

_http_client: httpx.Client | None = None


# KataGo column labels skip the letter "I": A-H, then J-T for a 19x19 board.
_KATAGO_COLUMNS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

# Canonical KataGo ruleset strings.
_KATAGO_RULES = frozenset(
    [
        "tromp-taylor",
        "chinese",
        "japanese",
        "korean",
        "aga",
        "aga-button",
        "chinese-ogs",
        "new-zealand",
        "stone-scoring",
        "ancient-territory",
        "bga",
    ]
)

# Map of lowercased SGF RU aliases → canonical KataGo ruleset string.
_RULES_ALIASES: dict[str, str] = {
    # Japanese
    "jp": "japanese",
    "jpn": "japanese",
    "japanese": "japanese",
    # Chinese
    "cn": "chinese",
    "chn": "chinese",
    "chinese": "chinese",
    # Ing (area scoring, closest to Chinese)
    "ing": "chinese",
    "ing's sst": "chinese",
    "goe": "chinese",
    # Korean
    "kr": "korean",
    "kor": "korean",
    "korean": "korean",
    # AGA
    "aga": "aga",
    "american": "aga",
    "us": "aga",
    # New Zealand
    "nz": "new-zealand",
    "new-zealand": "new-zealand",
    "new zealand": "new-zealand",
    # BGA / French
    "bga": "bga",
    "french": "bga",
    # Tromp-Taylor
    "tt": "tromp-taylor",
    "tromp-taylor": "tromp-taylor",
    "tromptaylor": "tromp-taylor",
    "tromp taylor": "tromp-taylor",
    # AGA with button
    "aga-button": "aga-button",
    # Chinese OGS variant
    "chinese-ogs": "chinese-ogs",
}


def get_http_client() -> httpx.Client:
    """Get or create a reusable HTTP client instance."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.Client(timeout=settings.api_timeout, base_url=settings.api_endpoint)
    return _http_client


def close_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        _http_client.close()
    _http_client = None


def _normalize_rules(raw: str) -> tuple[str, bool]:
    """Return ``(katago_ruleset, was_normalized)``.

    ``was_normalized`` is ``False`` when the value was already a canonical KataGo
    string or a known alias; ``True`` when we fell back to ``tromp-taylor``.
    """
    key = raw.strip().lower()
    if key in _KATAGO_RULES:
        return key, False
    if key in _RULES_ALIASES:
        return _RULES_ALIASES[key], False
    logger.warning("Unknown SGF ruleset %r — falling back to tromp-taylor", raw)
    return "tromp-taylor", True


def _extract_rules(root: sgf.Tree_node) -> str:
    """Return a KataGo-compatible ruleset string derived from the SGF root node."""
    if not root.has_property("RU"):
        return "tromp-taylor"
    try:
        raw = root.get("RU")
    except (ValueError, KeyError):
        return "tromp-taylor"
    if not isinstance(raw, str) or not raw.strip():
        return "tromp-taylor"
    ruleset, _ = _normalize_rules(raw)
    return ruleset


def _extract_komi(game: sgf.Sgf_game) -> float:
    """Return the komi from the SGF, defaulting to 7.5 if missing or malformed."""
    try:
        komi = game.get_komi()
    except ValueError:
        return 7.5
    if komi is None or komi == 0.0:
        return 7.5
    return float(komi)


def _sgfmill_point_to_katago(point: tuple[int, int]) -> str:
    """Convert an sgfmill ``(row, col)`` coordinate to a KataGo ``"Q4"``-style string.

    sgfmill uses ``row == 0`` for the bottom edge and ``col == 0`` for the left edge.
    KataGo uses columns ``A-T`` (skipping ``I``) and rows numbered from ``1`` at the
    bottom.
    """
    row, col = point
    return f"{_KATAGO_COLUMNS[col]}{row + 1}"


def sgf_to_winrate_request(sgf_content: str) -> dict[str, Any]:
    """Parse an SGF string into a KataGo analysis-engine request payload."""
    payload = sgf_content.encode("utf-8") if isinstance(sgf_content, str) else sgf_content
    game = sgf.Sgf_game.from_bytes(payload)

    board_size = game.get_size()
    root = game.get_root()

    black_setup, white_setup, _empty = root.get_setup_stones()
    initial_stones: list[list[str]] = []
    for point in sorted(black_setup):
        initial_stones.append(["B", _sgfmill_point_to_katago(point)])
    for point in sorted(white_setup):
        initial_stones.append(["W", _sgfmill_point_to_katago(point)])

    moves: list[list[str]] = []
    for node in game.get_main_sequence()[1:]:
        color, move = node.get_move()
        if color is None:
            continue
        katago_color = color.upper()
        if move is None:
            moves.append([katago_color, "pass"])
        else:
            moves.append([katago_color, _sgfmill_point_to_katago(move)])

    # analyzeTurns covers every position from before the first move through the
    # last move, i.e. turn 0 (initial position) up to turn len(moves) inclusive.
    winrate_analyze_turns = list(range(len(moves) + 1))

    return {
        "initialStones": initial_stones,
        "moves": moves,
        "rules": _extract_rules(root),
        "komi": _extract_komi(game),
        "boardXSize": board_size,
        "boardYSize": board_size,
        "analyzeTurns": winrate_analyze_turns,
        "maxVisits": 50,
        "analysisPVLen": 5,
        "includeOwnership": False,
        "includePolicy": False,
        "overrideSettings": {"wideRootNoise": 0.00},
    }


def winrate_request_to_detailed_request(
    winrate_request: dict[str, Any], analyze_turns: list[int]
) -> dict[str, Any]:
    detailed_request = copy.deepcopy(winrate_request)
    detailed_request["analyzeTurns"] = analyze_turns
    detailed_request["maxVisits"] = 500
    detailed_request["analysisPVLen"] = 15
    detailed_request["includeOwnership"] = True
    detailed_request["includePolicy"] = True
    detailed_request["overrideSettings"]["wideRootNoise"] = 0.04
    return detailed_request


def generate_commentary(sgf_content: str) -> Any:
    """Run the two-pass KataGo analysis and return the detailed results."""
    client = get_http_client()

    winrate_request = sgf_to_winrate_request(sgf_content)
    winrate_response = client.post("/analyze", json=winrate_request)
    winrate_response.raise_for_status()
    winrate_results = winrate_response.json()
    winrate_results = sorted(winrate_results, key=lambda x: x["turnNumber"])

    winrate_diff = []
    for turn_number in range(1, len(winrate_results)):
        result = winrate_results[turn_number]
        if result["rootInfo"]["currentPlayer"] == "B":
            diff = -(
                winrate_results[turn_number]["rootInfo"]["winrate"]
                - winrate_results[turn_number - 1]["rootInfo"]["winrate"]
            )
        else:
            diff = (
                winrate_results[turn_number]["rootInfo"]["winrate"]
                - winrate_results[turn_number - 1]["rootInfo"]["winrate"]
            )
        winrate_diff.append((result["turnNumber"], round(diff, 4)))
    winrate_diff = sorted(winrate_diff, key=lambda x: x[1])

    detailed_analyze_turns = [turn_number for turn_number, _ in winrate_diff[:20]]
    detailed_request = winrate_request_to_detailed_request(winrate_request, detailed_analyze_turns)
    detailed_response = client.post("/analyze", json=detailed_request)
    detailed_response.raise_for_status()
    return detailed_response.json()
