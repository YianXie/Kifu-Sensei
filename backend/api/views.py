import json
import logging
import uuid
from typing import Any

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from sgfmill import sgf

from .serializers import GenerateCommentarySerializer

logger = logging.getLogger(__name__)


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
    if komi is None:
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


def sgf_to_katago_request(sgf_content: str) -> dict[str, Any]:
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
    analyze_turns = list(range(len(moves) + 1))

    return {
        "id": str(uuid.uuid4()),
        "initialStones": initial_stones,
        "moves": moves,
        "rules": _extract_rules(root),
        "komi": _extract_komi(game),
        "boardXSize": board_size,
        "boardYSize": board_size,
        "analyzeTurns": analyze_turns,
    }


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class GenerateCommentaryView(APIView):
    def post(self, request: Request) -> Response:
        serializer = GenerateCommentarySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            katago_request = sgf_to_katago_request(serializer.validated_data["sgf_content"])
        except Exception as exc:
            logger.exception("Failed to parse SGF content")
            return Response(
                {"detail": f"Failed to parse SGF: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        print(json.dumps(katago_request, indent=2))
        return Response(katago_request)
