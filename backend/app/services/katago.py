import copy
import logging
import os
import threading
from collections import Counter
from collections.abc import Callable
from logging.handlers import RotatingFileHandler
from typing import Any, Literal

import httpx
from anthropic import Anthropic, APIError
from sgfmill import sgf
from sgfmill.ascii_boards import render_board
from sgfmill.boards import Board as SgfmillBoard

from app.config import settings
from app.crypto import decrypt_secret
from app.deps import CurrentUser
from app.errors import InvalidSgfError, MissingApiKeyError
from app.models import User
from app.services.board import (
    Board,
    BoardError,
    Color,
    Move,
    Point,
    move_from_go_notation,
    point_from_go_notation,
)
from app.services.concepts import (
    DetectorContext,
    OwnershipLengthError,
    render_detected_features,
    run_detectors,
)
from app.services.go_text import REGION_NAMES, ordinal

_http_client = None
_http_client_lock = threading.Lock()
log_path = "logs/katago_service.log"

logger = logging.getLogger("katago-service-logger")
logger.setLevel(logging.DEBUG)  # Set lowest threshold level

c_format = logging.Formatter("%(name)s - %(levelname)s - %(message)s")
f_format = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

c_handler = logging.StreamHandler()  # Console handler
c_handler.setLevel(logging.INFO)  # Show only INFO and above on console
c_handler.setFormatter(c_format)
logger.addHandler(c_handler)


def configure_file_logging() -> None:
    """Attach the rotating file handler. Called once from the app lifespan.

    Deliberately *not* done at import time: creating a ``logs/`` directory and opening
    a file are side effects of running the app, not of importing a service module.
    Doing them on import means every ``pytest`` run, every ``alembic`` command, and any
    tool that so much as imports this module writes log files into whatever directory
    it happened to be invoked from.

    Idempotent, so a second call (e.g. a ``TestClient`` context re-entering the
    lifespan) does not stack duplicate handlers and double every line.
    """
    if any(isinstance(handler, RotatingFileHandler) for handler in logger.handlers):
        return
    try:
        os.makedirs("logs", exist_ok=True)
        # Rotating rather than a bare FileHandler: the per-move prompt logged at DEBUG
        # below (the full ASCII board and ownership map, repeated per move per run) would
        # otherwise grow this file without bound as traffic accumulates. 10 MB * 5 backups
        # is generous for a single-instance deployment while still bounding disk use.
        f_handler = RotatingFileHandler(log_path, maxBytes=10_000_000, backupCount=5)
        f_handler.setLevel(logging.DEBUG)
        f_handler.setFormatter(f_format)
        logger.addHandler(f_handler)
    except OSError as e:
        logger.warning("Could not set up file logging (%s); console only.", e)


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

# Called as ``on_progress(done, total)`` after each comment is written, so a caller can
# publish real progress. Must not raise — see the guard in the job runner.
ProgressCallback = Callable[[int, int], None]

_CLAUDE_MODEL = "claude-sonnet-5"
_COMMENTARY_LANGUAGE = "english"
_MAX_TOKENS = 1024
# Left in place of a single move's comment when the Anthropic call for it keeps
# failing after the SDK's own retries — deliberately in plain English and clearly
# marked as a system message rather than analysis, regardless of the requested
# commentary language, since generating a translated placeholder would need another
# call to the very API that just failed.
_COMMENTARY_UNAVAILABLE_PLACEHOLDER = (
    "_(Commentary for this move could not be generated after repeated attempts.)_"
)


def get_http_client() -> httpx.Client:
    """Get or create a reusable HTTP client instance.

    The pipeline now runs several jobs concurrently on a dedicated executor (see
    ``app.routers.go``), so two calls can race in here at once; without the lock, both
    could see a stale client and each build their own, leaking whichever one loses.
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        with _http_client_lock:
            if _http_client is None or _http_client.is_closed:  # re-check: lost the race
                _http_client = httpx.Client(
                    timeout=settings.api_timeout,
                    base_url=settings.api_endpoint,  # type: ignore
                )
    return _http_client


def close_http_client() -> None:
    global _http_client
    with _http_client_lock:
        if _http_client is not None and not _http_client.is_closed:
            _http_client.close()
        _http_client = None


def _post_analysis(client: httpx.Client, request: dict[str, Any], *, pass_name: str) -> Any:
    """POST one analysis query and return the parsed result list.

    ``raise_for_status`` alone reports only the status code, so an upstream rejection
    arrives as a bare "422 Unprocessable Entity" with no way to tell which field the
    analysis server objected to. The body carries that detail, and it is the only copy
    — log it before the response is discarded.
    """
    response = client.post("/analyze", json=request)
    if response.is_error:
        logger.error(
            "KataGo rejected the %s pass with HTTP %s: %s (request: %s)",
            pass_name,
            response.status_code,
            _response_excerpt(response),
            _request_summary(request),
        )
    response.raise_for_status()
    return response.json()


def _response_excerpt(response: httpx.Response, limit: int = 2000) -> str:
    """Return the response body as text, truncated, for a log line."""
    try:
        body = response.text
    except UnicodeDecodeError:  # pragma: no cover - upstream always sends JSON or text
        return "<undecodable body>"
    return body[:limit] + "…" if len(body) > limit else body


def _request_summary(request: dict[str, Any]) -> str:
    """Describe a request without dumping the whole move list into the log."""
    analyze_turns = request.get("analyzeTurns", [])
    return (
        f"boardXSize={request.get('boardXSize')} boardYSize={request.get('boardYSize')} "
        f"rules={request.get('rules')!r} komi={request.get('komi')!r} "
        f"moves={len(request.get('moves', []))} "
        f"initialStones={len(request.get('initialStones', []))} "
        f"analyzeTurns={len(analyze_turns)} "
        f"(min={min(analyze_turns, default=None)}, max={max(analyze_turns, default=None)})"
    )


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
    """Return the komi from the SGF, defaulting to 7.5 only when KM is absent.

    ``get_komi()`` returns 0.0 both when ``KM`` is genuinely absent from the SGF and
    when it is explicitly set to ``KM[0]`` — the normal value for Chinese/Japanese
    handicap play — so the two cases can only be told apart by checking for the
    property directly. Without that check, every handicap game with an explicit zero
    komi was silently rescored with 7.5 points that were never actually in play,
    shifting every winrate and score-lead figure shown to the model.

    A malformed ``KM`` (e.g. non-numeric) is not handled here: sgfmill validates and
    converts every property eagerly when the SGF is parsed, so by the time a caller
    has a ``game`` object to pass in, ``KM`` already parsed cleanly.
    """
    if not game.get_root().has_property("KM"):
        return 7.5
    return float(game.get_komi())


def _sgfmill_point_to_katago(point: tuple[int, int]) -> str:
    """Convert an sgfmill ``(row, col)`` coordinate to a KataGo ``"Q4"``-style string.

    sgfmill uses ``row == 0`` for the bottom edge and ``col == 0`` for the left edge.
    KataGo uses columns ``A-T`` (skipping ``I``) and rows numbered from ``1`` at the
    bottom.
    """
    row, col = point
    return f"{_KATAGO_COLUMNS[col]}{row + 1}"


def _katago_point_to_sgfmill(point: str) -> tuple[int, int]:
    """Inverse of ``_sgfmill_point_to_katago``."""
    if point.lower() == "pass":
        raise ValueError("pass has no board coordinates")
    col = _KATAGO_COLUMNS.index(point[0].upper())
    row = int(point[1:]) - 1
    return row, col


def _intersection_count_to_point(count: int, board_size: int) -> tuple[int, int]:
    """Map a 1-based index in ``render_board`` order to sgfmill ``(row, col)``."""
    idx = count - 1
    display_row = idx // board_size
    row = board_size - 1 - display_row
    col = idx % board_size
    return row, col


def _color_letter_to_word(letter: Literal["B", "W"]) -> Literal["Black", "White"]:
    if letter == "B":
        return "White"
    return "Black"


def _katago_point_to_display(point: str, board_size: int) -> tuple[int, int]:
    """Convert a KataGo point to ``(display_row, col)`` in ownership-array order.

    ``display_row`` is 0 at the top of the board (KataGo's row-major ownership
    order), matching ``ownership[display_row * board_size + col]``.
    """
    row, col = _katago_point_to_sgfmill(point)
    return board_size - 1 - row, col


def _display_to_katago_point(display_row: int, col: int, board_size: int) -> str:
    """Inverse of :func:`_katago_point_to_display`."""
    sgfmill_row = board_size - 1 - display_row
    return _sgfmill_point_to_katago((sgfmill_row, col))


def _region_name(display_row: int, col: int, board_size: int) -> str:
    """Return the named region containing the given display coordinate."""
    first = board_size // 3
    second = (2 * board_size) // 3
    if display_row < first:
        vertical = "upper"
    elif display_row >= second:
        vertical = "lower"
    else:
        vertical = "center"
    if col < first:
        horizontal = "left"
    elif col >= second:
        horizontal = "right"
    else:
        horizontal = "center"
    return REGION_NAMES[(vertical, horizontal)]


def _ownership_symbol(value: float) -> str:
    """Map an ownership value in ``[-1, 1]`` to a single display character."""
    if value > 0.7:
        return "B"
    if value > 0.3:
        return "b"
    if value < -0.7:
        return "W"
    if value < -0.3:
        return "w"
    return "?"


def _strength_word(mean: float) -> str:
    """Qualitative descriptor for how strongly a region is owned."""
    magnitude = abs(mean)
    if magnitude > 0.55:
        return "firmly held"
    if magnitude > 0.25:
        return "leaning"
    return "loosely held"


def _black_winrate_pct(detail: dict[str, Any]) -> float:
    """Return the root winrate as Black's win probability, in percent."""
    winrate = detail["rootInfo"]["winrate"]
    return round(winrate * 100, 1)


def _score_lead(detail: dict[str, Any]) -> float:
    """Return the root score lead (positive = Black ahead)."""
    lead = detail["rootInfo"]["scoreLead"]
    return round(lead, 1)


def _prior_descriptor(prior: float) -> str:
    """Short qualitative note on a move's policy prior."""
    if prior < 0.02:
        return "very low — the neural net would rarely consider this move"
    if prior < 0.05:
        return "low — not an instinctive-looking move to the neural net"
    if prior < 0.15:
        return "moderate"
    return "high — a natural-looking move to the neural net"


def _mover_winrate_delta(detail: dict[str, Any], prev_detail: dict[str, Any]) -> float:
    """Return the win-rate change in percentage points for the player who just moved.

    Negative means the move lost win rate — this is the value clients render as the
    ``-18%`` badge. It is computed from the *detailed* analysis pass so that it matches
    the ``[CHANGE: ...]`` figure ``_generate_user_prompt`` puts in front of the model;
    the coarser first-pass numbers used for move selection would let the badge and the
    commentary text disagree.
    """
    color = _color_letter_to_word(detail["rootInfo"]["currentPlayer"])
    winrate = _black_winrate_pct(detail)
    prev_winrate = _black_winrate_pct(prev_detail)
    if color == "White":
        winrate = 100 - winrate
        prev_winrate = 100 - prev_winrate
    return round(winrate - prev_winrate, 1)


def _describe_pv_path(pv: list[str], board_size: int) -> str:
    """Return the one or two board regions a principal variation runs through."""
    names = []
    for point in pv:
        if point == "pass":
            continue
        display_row, col = _katago_point_to_display(point, board_size)
        names.append(_region_name(display_row, col, board_size))
    if not names:
        return ""
    top = [name for name, _ in Counter(names).most_common(2)]
    return " / ".join(top)


def _render_ownership_map(ownership: list[float], board_size: int) -> str:
    """Render KataGo's flat ownership array as an ASCII grid (top row first)."""
    columns = _KATAGO_COLUMNS[:board_size]
    lines = ["   " + " ".join(columns)]
    for display_row in range(board_size):
        row_number = board_size - display_row
        symbols = [
            _ownership_symbol(ownership[display_row * board_size + col])
            for col in range(board_size)
        ]
        lines.append(f"{row_number:>2} " + " ".join(symbols))
    return "\n".join(lines)


def _generate_ownership_summary(
    ownership: list[float],
    board_size: int,
    *,
    played_move: str | None,
    played_color: str,
) -> str:
    """Derive a human-readable bullet-point summary from KataGo's ownership array.

    ``ownership`` is KataGo's flat array in row-major order from the top-left
    (e.g. ``A19``) to the bottom-right (e.g. ``T1``); positive values lean Black
    and negative values lean White. The board is split into a 3x3 grid of named
    regions, and we report the areas Black and White hold most strongly, which
    regions remain undecided, and the local ownership around the move played.
    """
    first = board_size // 3
    second = (2 * board_size) // 3
    bands = [(0, first), (first, second), (second, board_size)]
    row_labels = ["upper", "center", "lower"]
    col_labels = ["left", "center", "right"]

    region_stats: dict[str, dict[str, Any]] = {}
    for i, (r0, r1) in enumerate(bands):
        for j, (c0, c1) in enumerate(bands):
            name = REGION_NAMES[(row_labels[i], col_labels[j])]
            cells = [
                (dr, c, ownership[dr * board_size + c])
                for dr in range(r0, r1)
                for c in range(c0, c1)
            ]
            net = sum(value for _, _, value in cells)
            mean = net / len(cells) if cells else 0.0
            region_stats[name] = {"mean": mean, "net": net, "cells": cells}

    bullets: list[str] = []

    # Black's strongest region (highest mean ownership).
    black_name, black = max(region_stats.items(), key=lambda kv: kv[1]["mean"])
    if black["mean"] > 0.1:
        anchor_row, anchor_col, _ = max(black["cells"], key=lambda c: c[2])
        anchor = _display_to_katago_point(anchor_row, anchor_col, board_size)
        bullets.append(
            f"- Black's strongest area is the {black_name} "
            f"({_strength_word(black['mean'])}, ~{round(abs(black['net']))} pts net, around {anchor})."
        )
    else:
        bullets.append("- Black has no clearly consolidated area yet.")

    # White's strongest region (lowest mean ownership).
    white_name, white = min(region_stats.items(), key=lambda kv: kv[1]["mean"])
    if white["mean"] < -0.1:
        anchor_row, anchor_col, _ = min(white["cells"], key=lambda c: c[2])
        anchor = _display_to_katago_point(anchor_row, anchor_col, board_size)
        bullets.append(
            f"- White's strongest area is the {white_name} "
            f"({_strength_word(white['mean'])}, ~{round(abs(white['net']))} pts net, around {anchor})."
        )
    else:
        bullets.append("- White has no clearly consolidated area yet.")

    # Regions that are still essentially undecided.
    contested = [name for name, stats in region_stats.items() if abs(stats["mean"]) <= 0.1]
    if contested:
        bullets.append(f"- Still largely undecided: {', '.join(contested[:4])}.")

    # Local ownership in the neighbourhood of the move that was played.
    if played_move and played_move != "pass":
        display_row, col = _katago_point_to_display(played_move, board_size)
        r0, r1 = max(0, display_row - 2), min(board_size, display_row + 3)
        c0, c1 = max(0, col - 2), min(board_size, col + 3)
        local_cells = [ownership[r * board_size + c] for r in range(r0, r1) for c in range(c0, c1)]
        local_mean = sum(local_cells) / len(local_cells)
        region = _region_name(display_row, col, board_size)
        if local_mean > 0.2:
            description = "leans Black"
        elif local_mean < -0.2:
            description = "leans White"
        else:
            description = "remains contested"
        bullet = (
            f"- {played_color} {played_move} sits in the {region}, where local "
            f"ownership {description} (local avg {local_mean:+.2f})."
        )
        if abs(local_mean) < 0.2:
            bullet += " The move did not clearly resolve ownership in this area."
        bullets.append(bullet)

    return "\n".join(bullets)


def _markable_point(katago_point: str | None, board_size: int) -> Point | None:
    """The point to mark on the diagram, or ``None`` if there is nothing to mark.

    A pass has no coordinates, and a coordinate the SGF got wrong should cost its
    marker rather than the review — the same bargain :func:`_replay_for_display`
    makes for the stones themselves.
    """
    if not katago_point or katago_point.lower() == "pass":
        return None
    try:
        return point_from_go_notation(katago_point, board_size)
    except BoardError as exc:
        logger.warning("Not marking %s on the board: %s", katago_point, exc)
        return None


def _replay_for_display(
    board_size: int, initial_stones: list[list[str]], moves: list[list[str]]
) -> SgfmillBoard:
    """Replay the game onto an sgfmill board, for the ASCII diagram in the prompt.

    A stone that will not go down is skipped rather than raised. sgfmill rejects a
    play onto an occupied point, and a malformed SGF that got this far would
    otherwise fail the whole review over one unusable stone — a commentary run with
    one stone missing from one diagram is a far better outcome than no commentary.

    Every skip is logged, which is how a genuinely broken game gets noticed rather
    than quietly producing odd-looking boards. In practice this should stay silent:
    a game whose moves KataGo refused never reaches prompt building at all.

    Deliberately more forgiving than :func:`_detected_features_block`, which
    abandons its whole block on the first bad move: this board is a visual aid, that
    one tells the model it may state its contents as fact.
    """
    board = SgfmillBoard(board_size)
    for colour, katago_point in [*initial_stones, *moves]:
        if not katago_point or katago_point.lower() == "pass":
            continue
        try:
            # Both failures are reported the same way on purpose: from the operator's
            # side "this stone is missing from the diagram" is one problem, whether the
            # coordinate would not parse or the point was already taken.
            point = point_from_go_notation(katago_point, board_size)
            board.play(point.row, point.col, colour.lower())
        except (BoardError, ValueError) as exc:
            logger.warning("Skipping %s %s while drawing the board: %s", colour, katago_point, exc)
    return board


def _setup_points(initial_stones: list[list[str]], colour: str, board_size: int) -> list[Point]:
    """Handicap and setup stones of one colour, as board points."""
    return [
        point_from_go_notation(point, board_size)
        for stone_colour, point in initial_stones
        if stone_colour == colour and point.lower() != "pass"
    ]


def _detected_features_block(
    *,
    board_size: int,
    initial_stones: list[list[str]],
    moves: list[list[str]],
    turn_number: int,
    detail: dict[str, Any],
    prev_detail: dict[str, Any],
) -> str:
    """Render the certified-facts block for the move played at ``turn_number``.

    Replays the game into :class:`app.services.board.Board` — a second replay
    alongside the sgfmill one above, which exists only to render the ASCII diagram
    and has no chain, liberty, or capture API to detect anything with. A full replay
    costs about a millisecond, so the duplication is cheaper than the coupling.

    Returns ``""`` on anything the strict rules engine rejects. Real SGFs contain
    moves played out of turn, onto occupied points, and odd handicap encodings, and
    the right price for that is losing this one block rather than the whole comment.
    """
    if not 1 <= turn_number <= len(moves):
        return ""
    try:
        board = Board(board_size).place_setup_stones(
            black=_setup_points(initial_stones, "B", board_size),
            white=_setup_points(initial_stones, "W", board_size),
        )
        previous: Move | None = None
        for colour, katago_point in moves[: turn_number - 1]:
            move = move_from_go_notation(katago_point, board_size)
            board = board.place_move(move, Color.from_letter(colour)).board
            previous = move

        colour, katago_point = moves[turn_number - 1]
        result = board.place_move(
            move_from_go_notation(katago_point, board_size), Color.from_letter(colour)
        )
        context = DetectorContext.from_analysis(
            board,
            result,
            move_number=turn_number,
            previous_move=previous,
            detail=detail,
            prev_detail=prev_detail,
        )
        return render_detected_features(run_detectors(context))
    except (BoardError, OwnershipLengthError) as exc:
        logger.warning("No detected-features block for turn %s: %s", turn_number, exc)
        return ""


def sgf_to_winrate_request(sgf_content: str) -> dict[str, Any]:
    """Parse an SGF string into a KataGo analysis-engine request payload."""
    payload = sgf_content.encode("utf-8") if isinstance(sgf_content, str) else sgf_content
    try:
        game = sgf.Sgf_game.from_bytes(payload)
    except ValueError as exc:
        # Raised as a typed error here rather than pattern-matched on ValueError in the
        # router: coordinate helpers elsewhere in this module raise ValueError too, and
        # those are bugs, not malformed input.
        raise InvalidSgfError(f"Could not parse the SGF file: {exc}") from exc

    board_size = game.get_size()
    root = game.get_root()

    # Setup stones (AB/AW/AE) usually live in the root node — the common handicap
    # shape OGS, KGS, and Sabaki all emit — but FF[4] also allows them in a bare
    # setup node between the root and the first move (e.g. a separate node just for
    # a comment, or an editor that split the root from the handicap stones). Reading
    # only ``root.get_setup_stones()`` silently drops those, so KataGo analyses a
    # handicap game as if the handicap stones were never placed. Accumulate across
    # every non-move node up to the first move instead. Setup encountered *after*
    # the first move cannot be applied at all — KataGo's ``initialStones`` can only
    # express one starting position — so it is logged and skipped rather than
    # silently ignored or failing an upload that today produces usable output.
    black_setup: set = set()
    white_setup: set = set()
    seen_first_move = False
    for node in game.get_main_sequence():
        color, _move = node.get_move()
        if color is not None:
            seen_first_move = True
            continue
        node_black, node_white, node_empty = node.get_setup_stones()
        if not (node_black or node_white or node_empty):
            continue
        if seen_first_move:
            logger.warning(
                "Ignoring AB/AW/AE setup after the first move: KataGo's initialStones "
                "cannot express a position change mid-game."
            )
            continue
        black_setup |= node_black
        white_setup |= node_white
        black_setup -= node_empty
        white_setup -= node_empty

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

    if not moves:
        # Caught here rather than left to the analysis server: the winrate pass would
        # succeed on the empty position, and only the detailed pass — built from the
        # then-empty list of impactful turns — would fail, blaming the engine for what
        # is really an unusable upload (a position diagram or a problem file).
        raise InvalidSgfError("This SGF contains no moves to comment on.")

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


def _generate_system_prompt(
    custom_instruction: str = "", language: str = _COMMENTARY_LANGUAGE
) -> str:
    prompt = """You are a Go game commentator writing move-by-move commentary for amateur players (SDK to DDK level).

    Your rules:
    - Ground every claim in the data provided. Do NOT invent tactical or strategic justifications that you cannot directly see in the board position or derive from the numbers.
    - If the data does not explain *why* a move is bad, say so honestly (e.g. "KataGo strongly preferred C5, though the exact reason is difficult to pin down from this position alone").
    - The [DETECTED FEATURES] block is computed from the board, not inferred. You may state those lines as fact. Lines that begin "estimated —" rest on tuned thresholds: hedge them or leave them out.
    - Use Go terminology ONLY for concepts named in that block. If it reports an atari, write "atari". If it does not mention a ladder, do not write "ladder". When the block is absent, describe the position in plain language instead of reaching for jargon.
    - The block reports what is on the board, never whether a move was good. A self-atari can be a throw-in and a working ladder can still be the wrong move — that judgement is yours to make from the position and the numbers.
    - Aim for 3–4 sentences. Tone: clear, educational, not condescending.
    - Structure: (1) brief game state, (2) assessment of the move played, (3) what the suggested move offered.
  """
    if custom_instruction.strip():
        prompt += (
            "\n    Additional instructions from the user (follow these where they do "
            "not conflict with the rules above):\n"
            f"    {custom_instruction.strip()}\n"
        )
    prompt += f"Always respond in {language}."
    return prompt


def _generate_user_prompt(
    detail: dict[str, Any],
    prev_detail: dict[str, Any],
    *,
    board_size: int,
    komi: float,
    rules: str,
    initial_stones: list[list[str]],
    moves: list[list[str]],
) -> str:
    turn_number = detail["turnNumber"]
    color = _color_letter_to_word(detail["rootInfo"]["currentPlayer"])

    prompt = "[GAME INFO]\n"
    prompt += f"Move {turn_number}. {color} just played. {board_size}*{board_size}, komi {komi}, {rules} rules.\n\n"
    prompt += "---\n\n"

    moves_through_turn = moves[:turn_number]
    last_move = moves_through_turn[-1][1] if moves_through_turn else None
    last_move_label = last_move.upper() if last_move else "(none)"
    last_move_sgfmill = _markable_point(last_move, board_size)
    top_suggestion = prev_detail["moveInfos"][0]["move"]
    top_suggestion_sgfmill = _markable_point(top_suggestion, board_size)
    board = _replay_for_display(board_size, initial_stones, moves_through_turn)
    ascii_board = list(render_board(board))
    count = 0
    for i, char in enumerate(ascii_board):
        if char not in ("#", "o", "."):
            continue
        count += 1
        point = _intersection_count_to_point(count, board_size)
        if last_move_sgfmill is not None and point == last_move_sgfmill:
            ascii_board[i] = "★"
        elif top_suggestion_sgfmill is not None and point == top_suggestion_sgfmill:
            ascii_board[i] = "*"
    ascii_board = "".join(ascii_board)
    prompt += f"[BOARD POSITION — after {color}'s move]\n"
    # KataGo skips the column letter "I" on every board size, not just 19x19 — e.g. a
    # 9x9 board's columns run A-H then J, not A-I — so both the last column and the
    # note have to come from the same KataGo alphabet the rest of this module uses
    # for move labels, rather than a plain unskipped a-z slice that only happened to
    # be right for one specific board size.
    last_column = _KATAGO_COLUMNS[board_size - 1]
    prompt += (
        f"Coordinates: columns A-{last_column} (left to right, I skipped), "
        f"rows 1-{board_size} (bottom to top).\n"
    )
    prompt += "Symbols: # = Black stone, o = White stone, . = empty\n"
    prompt += f"★ = the move {color} just played ({last_move_label})\n"
    prompt += f"* = KataGo's top suggestion ({top_suggestion})\n\n"
    prompt += f"{ascii_board}\n\n"
    prompt += "---\n\n"

    # Placed between the board and the numbers on purpose: the model reads the
    # position, then the facts that are certain about it, then the estimates.
    features = _detected_features_block(
        board_size=board_size,
        initial_stones=initial_stones,
        moves=moves,
        turn_number=turn_number,
        detail=detail,
        prev_detail=prev_detail,
    )
    if features:
        prompt += f"{features}\n---\n\n"

    prev_winrate = _black_winrate_pct(prev_detail)
    if color == "White":
        prev_winrate = 100 - prev_winrate
    prev_score_lead = _score_lead(prev_detail)
    winrate = _black_winrate_pct(detail)
    if color == "White":
        winrate = 100 - winrate
    score_lead = _score_lead(detail)

    # The CHANGE figures below are relative to the mover, exactly like the winrate
    # values themselves above — mirroring the score-lead delta for White is what keeps
    # it agreeing in sign with the winrate-CHANGE next to it. Without this, a White
    # move that gained winrate and gained points on the board would show, say,
    # "[CHANGE: +8.0%]" beside "[CHANGE: -5.0 pts]" for the same swing: the model
    # reads that as contradictory data and its commentary follows suit. The absolute
    # score-lead figures stay Black-relative, as the NOTE below documents.
    score_lead_change = score_lead - prev_score_lead
    if color == "White":
        score_lead_change *= -1

    prompt += "[KATAGO ANALYSIS DATA]\n"
    prompt += "NOTE: A positive score lead means Black is ahead, while a negative score lead means White is ahead.\n\n"
    prompt += f"Before {color}'s move (position after move {turn_number - 1}):\n"
    prompt += f"  {color} winrate:    {prev_winrate:.1f}%\n"
    prompt += (
        f"  Score lead:       {prev_score_lead:+.1f} pts "
        f"({'Black' if prev_score_lead >= 0 else 'White'} ahead)\n\n"
    )
    prompt += f"After {color} played {last_move_label} (position after move {turn_number}):\n"
    prompt += f"  {color} winrate:    {winrate:.1f}%   [CHANGE: {winrate - prev_winrate:+.1f}%]\n"
    prompt += f"  Score lead:       {score_lead:+.1f} pts [CHANGE: {score_lead_change:+.1f} pts for {color}]\n\n"

    played_info = next(
        (info for info in prev_detail["moveInfos"] if info["move"] == last_move), None
    )
    prompt += f"Move quality of {last_move_label}:\n"
    if played_info is not None:
        rank = played_info["order"] + 1
        prompt += f"  KataGo rank:  {ordinal(rank)} best move (order: {played_info['order']})\n"
        prompt += (
            f"  Policy prior: {played_info['prior']:.3f}  "
            f"({_prior_descriptor(played_info['prior'])})\n\n"
        )
    else:
        prompt += "  This move was not among KataGo's analyzed candidate moves.\n\n"

    top_suggestion_info = prev_detail["moveInfos"][0]
    top_suggestion_lead = top_suggestion_info["scoreLead"]
    top_suggestion_winrate = top_suggestion_info["winrate"] * 100
    if color == "White":
        top_suggestion_winrate = 100 - top_suggestion_winrate
    prompt += f"KataGo's top suggestion for {color} — {top_suggestion}:\n"
    prompt += f"  {color} winrate after {top_suggestion}:    {top_suggestion_winrate:.1f}%\n"
    prompt += f"  Score lead after {top_suggestion}: {top_suggestion_lead:+.1f} pts\n"

    suggestion_pv = top_suggestion_info.get("pv", [])
    if suggestion_pv:
        prompt += f"  Principal variation: {' → '.join(suggestion_pv)} ...\n"
        pv_regions = _describe_pv_path(suggestion_pv, board_size)
        depth_note = f"(Sequence runs {len(suggestion_pv)} moves deep"
        depth_note += f" along the {pv_regions}.)" if pv_regions else ".)"
        prompt += f"  {depth_note}\n"
    prompt += "\n---\n\n"

    ownership = detail.get("ownership")
    if ownership:
        prompt += f"[OWNERSHIP MAP — after {color} {last_move_label}]\n"
        prompt += "Pre-processed from KataGo's raw ownership array.\n"
        prompt += "B = strongly Black (>0.7), b = leaning Black (0.3 to 0.7)\n"
        prompt += "? = contested (-0.3 to 0.3)\n"
        prompt += "w = leaning White (-0.3 to -0.7), W = strongly White (<-0.7)\n\n"
        prompt += f"{_render_ownership_map(ownership, board_size)}\n\n"
        prompt += "Ownership summary (derived):\n"
        prompt += (
            _generate_ownership_summary(
                ownership,
                board_size,
                played_move=last_move,
                played_color=color,
            )
            + "\n\n"
        )
        prompt += "---\n\n"

    prompt += "[YOUR TASK]\n"
    prompt += (
        f"Write a commentary comment (3-4 sentences) for {color}'s move {last_move_label}.\n\n"
    )
    prompt += "Follow this structure:\n"
    prompt += "1. One sentence on the game situation at this point (use the numbers).\n"
    prompt += (
        f"2. One sentence on {last_move_label} — honest about its quality, tied to the data.\n"
    )
    prompt += (
        f"3. One or two sentences on {top_suggestion} — what it offered, based on what you "
        "can see in the board, ownership map, and the PV. Do NOT invent tactical details "
        "you cannot verify.\n\n"
    )
    prompt += (
        f"If the board does not clearly explain why {top_suggestion} is better, say so and "
        "stick to what the data shows (winrate gain, score gain, where the PV runs).\n\n"
    )

    return prompt


def _empty_usage() -> dict[str, int]:
    """Return a zeroed token-usage accumulator."""
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }


def _accumulate_usage(totals: dict[str, int], usage: Any) -> None:
    """Add one Anthropic response's token counts into ``totals``.

    The cache counters are ``None`` unless prompt caching is in play. The pipeline does
    not use it — the system prompt is far below the minimum cacheable prefix, so a
    ``cache_control`` marker would silently never cache — but they are summed anyway so
    turning caching on later needs no change here. ``getattr`` guards against SDK
    versions that omit the attributes entirely.
    """
    totals["input_tokens"] += getattr(usage, "input_tokens", 0) or 0
    totals["output_tokens"] += getattr(usage, "output_tokens", 0) or 0
    totals["cache_read_input_tokens"] += getattr(usage, "cache_read_input_tokens", 0) or 0
    totals["cache_creation_input_tokens"] += getattr(usage, "cache_creation_input_tokens", 0) or 0


def generate_commentary_with_claude(
    user: User,
    prompts: list[str],
    *,
    model: str = _CLAUDE_MODEL,
    language: str = _COMMENTARY_LANGUAGE,
    max_token: int = _MAX_TOKENS,
    custom_instruction: str = "",
    on_progress: ProgressCallback | None = None,
) -> tuple[list[str], dict[str, int]]:
    """Example: decrypt the user's Claude API key and call the Anthropic API.

    The key is only decrypted in memory, here, at the moment it is used — it is never
    logged and never leaves the server. ``user.claude_api`` holds the Fernet ciphertext
    that was stored via the ``PUT /auth/user/claude-api-key/`` endpoint.
    """
    if not user.has_claude_api_key or not user.claude_api:
        raise MissingApiKeyError("This account has no Claude API key configured.")

    # Decrypt the stored ciphertext back into the usable API key.
    claude_api_key = decrypt_secret(user.claude_api)

    client = Anthropic(api_key=claude_api_key)

    system_prompt = _generate_system_prompt(
        custom_instruction=custom_instruction, language=language
    )
    comments: list[str] = []
    usage = _empty_usage()
    failures = 0
    last_error: APIError | None = None
    # Publish the total before the first call so a poller can show "0 of N" rather than
    # "0 of 0" for the length of the first request.
    if on_progress is not None:
        on_progress(0, len(prompts))
    for user_prompt in prompts:
        try:
            message = client.messages.create(
                model=model,
                max_tokens=max_token,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": user_prompt,
                    }
                ],
            )
        except APIError as exc:
            # The SDK already retries a single call across transient failures
            # (rate limits, 5xx, connection errors) with backoff before this is ever
            # raised, so losing one comment here is the last resort — but it is far
            # better than discarding every comment already generated (and billed)
            # in this run just because one move's call kept failing.
            logger.warning("Anthropic call failed for one move; leaving a placeholder: %s", exc)
            comments.append(_COMMENTARY_UNAVAILABLE_PLACEHOLDER)
            failures += 1
            last_error = exc
            if on_progress is not None:
                on_progress(len(comments), len(prompts))
            continue

        text = "".join(block.text for block in message.content if block.type == "text")
        comments.append(text)
        _accumulate_usage(usage, message.usage)
        if on_progress is not None:
            on_progress(len(comments), len(prompts))

    if prompts and failures == len(prompts):
        # Every call failed — there is nothing to salvage, and returning here would
        # report a run of nothing but placeholders as a success. Re-raise the last
        # error so the caller classifies and reports it normally (e.g. a bad API key
        # correctly surfaces as upstream_auth_failed rather than as silent placeholders).
        raise last_error

    return comments, usage


def _katago_moves_to_frontend(
    katago_moves: list[list[str]],
    initial_stones: list[list[str]],
) -> tuple[list[list], list[list]]:
    """Convert KataGo move lists to frontend ``[color, [row, col] | null]`` tuples."""
    frontend_initial: list[list] = []
    for color, point in initial_stones:
        row, col = _katago_point_to_sgfmill(point)
        frontend_initial.append([color, [row, col]])

    frontend_moves: list[list] = []
    for color, point in katago_moves:
        if point == "pass":
            frontend_moves.append([color, None])
        else:
            row, col = _katago_point_to_sgfmill(point)
            frontend_moves.append([color, [row, col]])
    return frontend_moves, frontend_initial


def _inject_comments_into_sgf(sgf_content: str, comments: list[dict[str, Any]]) -> str:
    """Return the SGF string with C[] comment properties inserted for each annotated move.

    ``comments`` is a list of ``{"turn": int, "comment": str}`` dicts where ``turn`` is
    1-based and counts *move* nodes only, exactly like ``sgf_to_winrate_request`` numbers
    them. Counting main-sequence nodes instead (as this used to) desyncs the two the
    moment a non-move node — a bare comment, or setup stones in their own node — appears
    before or between moves, silently shifting every comment onto the wrong move.
    sgfmill handles escaping of ``]`` and ``\\`` inside property values automatically.
    """
    comment_map: dict[int, str] = {item["turn"]: item["comment"] for item in comments}
    payload = sgf_content.encode("utf-8") if isinstance(sgf_content, str) else sgf_content
    # Force a UTF-8 presenter so SGF comments from the LLM can include
    # punctuation like em dashes without latin-1 serialization failures.
    try:
        game = sgf.Sgf_game.from_bytes(payload, override_encoding="utf-8")
    except ValueError as exc:
        raise InvalidSgfError(f"Could not re-parse the SGF file: {exc}") from exc

    turn = 0
    for node in game.get_main_sequence()[1:]:
        color, _move = node.get_move()
        if color is None:
            continue  # not a move node: skip without consuming a turn number
        turn += 1
        if turn not in comment_map:
            continue
        new_comment = comment_map[turn]
        if node.has_property("C"):
            # Preserve rather than clobber a comment already on this move (e.g. from
            # the original SGF, or handicap setup sharing the node with the first move).
            node.set("C", f"{node.get('C')}\n\n{new_comment}")
        else:
            node.set("C", new_comment)
    return game.serialise().decode("utf-8")


def generate_commentary(
    sgf_content: str,
    user: CurrentUser,
    *,
    model: str = _CLAUDE_MODEL,
    sgf_file_name: str,
    language: str = _COMMENTARY_LANGUAGE,
    num_comments: int = 20,
    max_token: int = _MAX_TOKENS,
    custom_instruction: str = "",
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Run the two-pass KataGo analysis and return board data with commentary."""
    # Checked up front, not just at the Claude call below: the KataGo passes take
    # minutes, and there is no point spending them for a user who cannot be billed for
    # the commentary at the end. generate_commentary_with_claude re-checks, since it is
    # callable on its own.
    if not user.has_claude_api_key or not user.claude_api:
        raise MissingApiKeyError("This account has no Claude API key configured.")

    client = get_http_client()

    winrate_request = sgf_to_winrate_request(sgf_content)
    winrate_results = _post_analysis(client, winrate_request, pass_name="winrate")
    winrate_results = sorted(winrate_results, key=lambda x: x["turnNumber"])

    winrate_diff = []
    for turn_number in range(1, len(winrate_results)):
        result = winrate_results[turn_number]
        diff = (
            winrate_results[turn_number]["rootInfo"]["winrate"]
            - winrate_results[turn_number - 1]["rootInfo"]["winrate"]
        )
        if result["rootInfo"]["currentPlayer"] == "B":
            # White has just played the move
            # Therefore, if black's winrate decreases, white has played a good move, and vice-versa
            diff *= -1
        winrate_diff.append((result["turnNumber"], round(diff * 100, 1)))

    winrate_diff = sorted(winrate_diff, key=lambda x: x[1])
    detailed_analyze_turns = [
        turn_number for turn_number, _ in winrate_diff[:num_comments]
    ]  # take the ``num_comments`` most impactful moves
    detailed_analyze_prev_turns = [
        turn_number - 1 for turn_number in detailed_analyze_turns
    ]  # each turn's previous turn
    detailed_request = winrate_request_to_detailed_request(winrate_request, detailed_analyze_turns)
    detailed_prev_request = winrate_request_to_detailed_request(
        winrate_request, detailed_analyze_prev_turns
    )
    detailed_results = _post_analysis(client, detailed_request, pass_name="detailed")
    detailed_prev_results = _post_analysis(
        client, detailed_prev_request, pass_name="detailed-previous"
    )

    detailed_results = sorted(detailed_results, key=lambda x: x["turnNumber"])
    detailed_prev_results = sorted(detailed_prev_results, key=lambda x: x["turnNumber"])

    board_size = detailed_request["boardXSize"]
    komi = detailed_request["komi"]
    rules = detailed_request["rules"]
    moves = detailed_request["moves"]
    initial_stones = detailed_request["initialStones"]

    prompts: list[str] = []
    for i in range(len(detailed_results)):
        prompt = _generate_user_prompt(
            detailed_results[i],
            detailed_prev_results[i],
            board_size=board_size,
            komi=komi,
            rules=rules,
            initial_stones=initial_stones,
            moves=moves,
        )
        prompts.append(prompt)
        # DEBUG, not INFO: the console handler is INFO-and-above, and on a hosted
        # platform stdout typically ships straight to a log aggregator — logging the
        # full prompt (ASCII board, ownership map) there on every move, for every
        # run, sends it to a third-party log store for no operational benefit. The
        # file handler is DEBUG-and-above, so it still lands in the rotated log file
        # for local debugging.
        logger.debug("User prompt for move %d:\n%s\n", detailed_results[i]["turnNumber"], prompt)

    comment_texts, usage = generate_commentary_with_claude(
        user,
        prompts,
        model=model,
        language=language,
        max_token=max_token,
        custom_instruction=custom_instruction,
        on_progress=on_progress,
    )
    frontend_moves, frontend_initial = _katago_moves_to_frontend(moves, initial_stones)
    comments: list[dict[str, Any]] = []
    for i, detail in enumerate(detailed_results):
        turn = detail["turnNumber"]
        comments.append(
            {
                "turn": turn,
                "comment": comment_texts[i],
                "winrate_delta": _mover_winrate_delta(detail, detailed_prev_results[i]),
                # ``turn`` is 1-based over the SGF main sequence; ``moves`` is 0-based.
                # Read from the move list rather than inferred from turn parity, which
                # is wrong for handicap games — those open with White to play.
                "color": moves[turn - 1][0],
            }
        )
    return {
        "board_size": board_size,
        "sgf_file_name": sgf_file_name,
        "language": language,
        "model": model,
        "usage": usage,
        "moves": frontend_moves,
        "initial_stones": frontend_initial,
        "comments": comments,
        "annotated_sgf_content": _inject_comments_into_sgf(sgf_content, comments),
    }
