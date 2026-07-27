"""Deterministic Go concept detectors and the prompt block they render into.

KataGo's numbers say a move lost 8% winrate; they never say *why*. The model is
left to guess a tactical reason, and a guessed reason is exactly the vague,
hedge-laden commentary this pipeline exists to avoid. These detectors compute the
reasons that are computable — contact, atari, capture, connection, ko — from the
board itself, so the model states them rather than inferring them.

**Detectors emit observations, never judgements.** ``self-atari: the played chain
has 1 liberty`` is a fact. ``bad move`` is not: self-atari is correct in throw-ins,
nakade, and snapback. A detector that ranks a move smuggles unfounded confidence
back into the pipeline, which is the failure this whole layer is here to prevent.

Every detector is a pure function of a :class:`DetectorContext`. No I/O, no logging,
no mutation, standard library only — importing this module must stay cheap, which is
why nothing here reaches into :mod:`app.services.katago` (that pulls in Anthropic,
httpx, and settings at import time).

Adding a detector in a later tier means writing a function and appending it to
:data:`DETECTORS`. Nothing else changes: the renderer holds no per-concept
knowledge, so there is no dispatch chain to edit.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import Enum, IntEnum
from typing import Any, Final

from app.services.board import (
    Board,
    Chain,
    Color,
    Move,
    MoveResult,
    Point,
    point_to_go_notation,
)

__all__ = [
    "DETECTORS",
    "Certainty",
    "Detector",
    "DetectorContext",
    "Finding",
    "Salience",
    "context_for_move",
    "render_detected_features",
    "run_detectors",
]


# ── Tunable thresholds ────────────────────────────────────────────────────────
#
# Named rather than inline so the three heuristic detectors can be retuned against
# real games without hunting for magic numbers. Everything else in this module is
# exact and has nothing to tune.

#: Chebyshev distance from the opponent's previous move at or beyond which a move
#: counts as tenuki. Distance is only a proxy for "ignored the local situation" —
#: a 4-point jump can abandon a fight and a 6-point one can be a direct answer.
_TENUKI_MIN_DISTANCE: Final = 5

#: Board progress (see :func:`detect_game_phase`) below which the game is called an
#: opening, and below which a middlegame. Phase boundaries are genuinely fuzzy;
#: these are conventions, not rules.
_OPENING_MAX_PROGRESS: Final = 0.20
_MIDDLEGAME_MAX_PROGRESS: Final = 0.55

#: The outer band of the board, as a fraction of its width, used to split corner /
#: side / centre. A third gives a 7-line band on 19x19 (so the centre is the middle
#: 5x5), 5 on 13x13, and 3 on 9x9.
_ZONE_BAND_DIVISOR: Final = 3

#: Ceiling on how many points a single finding spells out before it summarises. A
#: 30-stone chain would otherwise produce one unreadable line and eat the budget.
_MAX_POINTS_LISTED: Final = 6

#: The feature block is capped so that ~250 moves of commentary do not drown the
#: two-pass pipeline in mostly-unremarkable lines.
_MAX_FEATURE_LINES: Final = 8

_LABEL_WIDTH: Final = 18

_FEATURE_HEADER: Final = (
    "[DETECTED FEATURES — computed from the board, not inferred. You may state these as fact.]"
)
_HEURISTIC_NOTE: Final = (
    "Lines tagged (heuristic) are threshold-based approximations — hedge them or omit them."
)


# ── Result types ──────────────────────────────────────────────────────────────


class Salience(IntEnum):
    """How hard a finding fights for a slot in the capped feature block.

    Ordered so that a plain sort puts the most salient first.
    """

    CRITICAL = 0
    """Always surfaces: atari, capture, ko, self-atari."""

    NOTABLE = 1
    """Surfaces when there is room: contact, connection, tenuki."""

    BACKGROUND = 2
    """Surfaces only when little else fired: line, zone, phase, liberty count."""


class Certainty(Enum):
    """Whether a finding is computed exactly or from a tuned threshold."""

    EXACT = "exact"
    HEURISTIC = "heuristic"


@dataclass(frozen=True, slots=True)
class Finding:
    """One thing a detector observed.

    ``detail`` is phrased by the detector rather than the renderer. The renderer
    stays free of per-concept knowledge that way, so a later tier adds a function
    to :data:`DETECTORS` instead of extending a dispatch chain in two places.

    ``supersedes`` names concepts this finding replaces when both fired. It exists
    so that "double atari" can absorb "atari given" without either detector knowing
    about the other — the detectors stay independent and the dominance is declared
    data that :func:`run_detectors` applies generically.
    """

    concept: str
    label: str
    detail: str
    salience: Salience
    points: tuple[Point, ...] = ()
    certainty: Certainty = Certainty.EXACT
    supersedes: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True, slots=True)
class DetectorContext:
    """Everything known about a single move, frozen.

    The KataGo fields are unused by every Tier 1 detector and carried anyway:
    Tier 2 depends on them entirely, and widening this signature later would mean
    touching every detector written against it.
    """

    board_before: Board
    result: MoveResult
    move_number: int
    previous_move: Move | None = None
    root_info: Mapping[str, Any] | None = None
    move_infos: Sequence[Mapping[str, Any]] | None = None
    ownership: Sequence[float] | None = None

    def __post_init__(self) -> None:
        if self.board_before.size != self.result.board.size:
            raise ValueError(
                "board_before and the move result describe different board sizes: "
                f"{self.board_before.size} vs {self.result.board.size}"
            )
        if self.move_number < 0:
            raise ValueError(f"move_number must not be negative, got {self.move_number}")

    @property
    def board_after(self) -> Board:
        return self.result.board

    @property
    def color(self) -> Color:
        """The colour that played this move."""
        return self.result.color

    @property
    def board_size(self) -> int:
        return self.board_before.size

    @property
    def is_pass(self) -> bool:
        return self.result.is_pass

    @property
    def point(self) -> Point | None:
        """The point played, or ``None`` on a pass."""
        move = self.result.move
        return move if isinstance(move, Point) else None


#: A detector takes a context and returns one finding, or ``None`` when it does not
#: apply. It must not raise, and must not emit a placeholder for "nothing here".
#: A detector that observes several instances of its concept (three chains left in
#: atari, say) aggregates them into a single finding rather than returning a list —
#: that keeps one concept to one line in the capped block.
type Detector = Callable[[DetectorContext], Finding | None]


def context_for_move(
    board: Board,
    move: Move,
    *,
    move_number: int,
    color: Color | None = None,
    previous_move: Move | None = None,
    root_info: Mapping[str, Any] | None = None,
    move_infos: Sequence[Mapping[str, Any]] | None = None,
    ownership: Sequence[float] | None = None,
) -> DetectorContext:
    """Play ``move`` on ``board`` and wrap the before/after pair in a context.

    Illegal moves propagate the Tier 0 exception unchanged; a caller replaying a
    real game wants to hear about that rather than get a context describing a move
    that never happened.
    """
    return DetectorContext(
        board_before=board,
        result=board.place_move(move, color),
        move_number=move_number,
        previous_move=previous_move,
        root_info=root_info,
        move_infos=move_infos,
        ownership=ownership,
    )


# ── Phrasing helpers ──────────────────────────────────────────────────────────

_COLOR_WORDS: Final[dict[Color, str]] = {Color.BLACK: "Black", Color.WHITE: "White"}


def _word(color: Color) -> str:
    return _COLOR_WORDS[color]


def _name(point: Point, board_size: int) -> str:
    return point_to_go_notation(point, board_size)


def _names(points: Iterable[Point], board_size: int) -> str:
    """Render points in reading order, summarising past :data:`_MAX_POINTS_LISTED`."""
    ordered = sorted(points)
    shown = [_name(point, board_size) for point in ordered[:_MAX_POINTS_LISTED]]
    remaining = len(ordered) - len(shown)
    if remaining > 0:
        shown.append(f"+{remaining} more")
    return "/".join(shown)


def _plural(count: int, singular: str, plural: str) -> str:
    return singular if count == 1 else plural


def _ordinal(n: int) -> str:
    """Return the ordinal string for ``n`` (e.g. ``1`` -> ``"1st"``).

    Duplicated from :mod:`app.services.katago` on purpose: importing that module
    would drag Anthropic, httpx, and application settings into what is meant to be
    a dependency-free computation layer. Worth lifting into a shared text helper
    when this layer is wired into the prompt builder.
    """
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# ── Shared board queries ──────────────────────────────────────────────────────


def _adjacent_chains(board: Board, point: Point, color: Color) -> tuple[Chain, ...]:
    """Distinct ``color`` chains touching ``point``, in a stable order."""
    found: list[Chain] = []
    seen: set[Point] = set()
    for neighbor in board.neighbors(point):
        if board.get(neighbor) is not color or neighbor in seen:
            continue
        chain = board.chain_at(neighbor)
        seen |= chain.points
        found.append(chain)
    return tuple(found)


def _newly_ataried_enemy_chains(context: DetectorContext) -> tuple[Chain, ...]:
    """Enemy chains whose liberty count *transitioned* to 1 because of this move.

    The transition matters. A chain sitting at one liberty before the move is still
    at one liberty after it, and reporting that as an atari given by this move is
    simply false. Only chains adjacent to the played point are candidates: placing
    a stone can lower no other chain's liberties, and captures only raise them.
    """
    point = context.point
    if point is None:
        return ()
    before, after = context.board_before, context.board_after
    enemy = context.color.opponent

    found: list[Chain] = []
    seen: set[Point] = set()
    for neighbor in after.neighbors(point):
        if after.get(neighbor) is not enemy or neighbor in seen:
            continue
        chain = after.chain_at(neighbor)
        seen |= chain.points
        if len(after.liberties(chain)) != 1:
            continue
        if len(before.liberties(before.chain_at(neighbor))) == 1:
            continue  # already in atari before the move — not given by it
        found.append(chain)
    return tuple(found)


# ── Detectors: stone relationships ────────────────────────────────────────────


def detect_contact_play(context: DetectorContext) -> Finding | None:
    """The played stone is orthogonally adjacent to at least one enemy stone."""
    point = context.point
    if point is None:
        return None
    before = context.board_before
    enemy = context.color.opponent
    touched = tuple(p for p in before.neighbors(point) if before.get(p) is enemy)
    if not touched:
        return None
    size = context.board_size
    return Finding(
        concept="contact_play",
        label="Contact play",
        detail=(
            f"{_name(point, size)} is played directly against "
            f"{_word(enemy)} {_names(touched, size)}"
        ),
        salience=Salience.NOTABLE,
        points=tuple(sorted(touched)),
    )


def detect_extension(context: DetectorContext) -> Finding | None:
    """The played stone is orthogonally adjacent to at least one friendly stone."""
    point = context.point
    if point is None:
        return None
    before = context.board_before
    friendly = context.color
    attached = tuple(p for p in before.neighbors(point) if before.get(p) is friendly)
    if not attached:
        return None
    size = context.board_size
    return Finding(
        concept="extension",
        label="Extension",
        detail=(
            f"{_name(point, size)} is played solidly next to "
            f"{_word(friendly)} {_names(attached, size)}"
        ),
        salience=Salience.NOTABLE,
        points=tuple(sorted(attached)),
    )


def detect_connection(context: DetectorContext) -> Finding | None:
    """Two or more previously distinct friendly chains are merged by this move.

    Counted on the board *before* the stone lands: afterwards they are one chain
    and the join is no longer visible.
    """
    point = context.point
    if point is None:
        return None
    chains = _adjacent_chains(context.board_before, point, context.color)
    if len(chains) < 2:
        return None
    size = context.board_size
    joined = tuple(sorted(p for chain in chains for p in chain.points))
    return Finding(
        concept="connection",
        label="Connection",
        detail=(
            f"{_name(point, size)} joins {len(chains)} previously separate "
            f"{_word(context.color)} chains ({len(joined)} stones) into one"
        ),
        salience=Salience.NOTABLE,
        points=joined,
    )


# ── Detectors: liberties and atari ────────────────────────────────────────────


def detect_liberty_count(context: DetectorContext) -> Finding | None:
    """Liberties of the played chain once captures have resolved."""
    liberties = context.result.liberties_after
    if liberties is None:
        return None
    size = context.board_size
    count = len(liberties)
    return Finding(
        concept="liberty_count",
        label="Liberties",
        detail=(
            f"the played {_word(context.color)} chain has {count} "
            f"{_plural(count, 'liberty', 'liberties')} ({_names(liberties, size)})"
        ),
        salience=Salience.BACKGROUND,
        points=tuple(sorted(liberties)),
    )


def detect_atari_given(context: DetectorContext) -> Finding | None:
    """An enemy chain dropped to exactly one liberty as a result of this move."""
    chains = _newly_ataried_enemy_chains(context)
    if not chains:
        return None
    size = context.board_size
    stones = tuple(sorted(p for chain in chains for p in chain.points))
    enemy = _word(context.color.opponent)
    if len(chains) == 1:
        detail = f"the {enemy} chain at {_names(stones, size)} is down to 1 liberty"
    else:
        detail = f"{len(chains)} {enemy} chains are down to 1 liberty ({_names(stones, size)})"
    return Finding(
        concept="atari_given",
        label="Atari given",
        detail=detail,
        salience=Salience.CRITICAL,
        points=stones,
    )


def detect_double_atari(context: DetectorContext) -> Finding | None:
    """Two or more enemy chains are put in atari by the same move.

    Reported as one finding, and it supersedes ``atari_given`` so the block does not
    spend two of its capped lines saying the same thing twice.
    """
    chains = _newly_ataried_enemy_chains(context)
    if len(chains) < 2:
        return None
    size = context.board_size
    stones = tuple(sorted(p for chain in chains for p in chain.points))
    summary = ", ".join(_names(chain.points, size) for chain in chains)
    return Finding(
        concept="double_atari",
        label="Double atari",
        detail=(
            f"{len(chains)} separate {_word(context.color.opponent)} chains are put on "
            f"1 liberty at once: {summary}"
        ),
        salience=Salience.CRITICAL,
        points=stones,
        supersedes=frozenset({"atari_given"}),
    )


def detect_self_atari(context: DetectorContext) -> Finding | None:
    """The played chain has exactly one liberty after the move.

    Reports the count and nothing else. Self-atari is usually a blunder and is
    exactly right in a throw-in, a nakade, or a snapback, and this layer has no
    way to tell those apart — ranking the move is the model's job.
    """
    result = context.result
    if not result.is_self_atari or result.chain_after is None or result.liberties_after is None:
        return None
    size = context.board_size
    chain = result.chain_after
    count = len(chain.points)
    return Finding(
        concept="self_atari",
        label="Self-atari",
        detail=(
            f"the played {_word(context.color)} chain ({count} "
            f"{_plural(count, 'stone', 'stones')} at {_names(chain.points, size)}) is left with "
            f"1 liberty at {_names(result.liberties_after, size)}"
        ),
        salience=Salience.CRITICAL,
        points=tuple(sorted(chain.points)),
    )


def detect_atari_ignored(context: DetectorContext) -> Finding | None:
    """A friendly chain was in atari before the move and still is after it.

    Scans every friendly chain, not just the local one: "your group in the upper
    right was in atari and you played in the lower left" is the whole lesson, and it
    is invisible to anything that only looks near the played stone.

    A move that joins the endangered chain has addressed it — badly, if the merged
    chain is still on one liberty, but that is what ``self_atari`` reports.
    """
    before, after = context.board_before, context.board_after
    friendly = context.color
    played = context.point

    ignored: list[Chain] = []
    for chain in before.chains():
        if chain.color is not friendly or len(before.liberties(chain)) != 1:
            continue
        anchor = min(chain.points)
        if after.get(anchor) is not friendly:
            continue
        chain_after = after.chain_at(anchor)
        if played is not None and played in chain_after.points:
            continue  # the move connected to it, so it was not ignored
        if len(after.liberties(chain_after)) != 1:
            continue
        ignored.append(chain)

    if not ignored:
        return None
    size = context.board_size
    stones = tuple(sorted(p for chain in ignored for p in chain.points))
    word = _word(friendly)
    if len(ignored) == 1:
        detail = (
            f"the {word} chain at {_names(stones, size)} was in atari before this move "
            "and is still in atari"
        )
    else:
        detail = (
            f"{len(ignored)} {word} chains were in atari before this move and still are "
            f"({_names(stones, size)})"
        )
    return Finding(
        concept="atari_ignored",
        label="Atari ignored",
        detail=detail,
        salience=Salience.CRITICAL,
        points=stones,
    )


# ── Detectors: captures and ko ────────────────────────────────────────────────


def detect_capture(context: DetectorContext) -> Finding | None:
    """Stones were removed from the board by this move."""
    captured = context.result.captured
    if not captured:
        return None
    size = context.board_size
    count = len(captured)
    chains = len(context.result.captured_chains)
    detail = (
        f"{count} {_word(context.color.opponent)} "
        f"{_plural(count, 'stone', 'stones')} removed at {_names(captured, size)}"
    )
    if chains > 1:
        detail += f", across {chains} chains"
    return Finding(
        concept="capture",
        label="Capture",
        detail=detail,
        salience=Salience.CRITICAL,
        points=tuple(sorted(captured)),
    )


def detect_ko_capture(context: DetectorContext) -> Finding | None:
    """The move was a single-stone capture that created a ko.

    Reads the ko state Tier 0 already resolved for legality
    (:attr:`~app.services.board.MoveResult.ko_point`) rather than recomputing it.
    """
    ko_point = context.result.ko_point
    if ko_point is None:
        return None
    size = context.board_size
    return Finding(
        concept="ko_capture",
        label="Ko",
        detail=(
            f"a one-stone capture at {_name(ko_point, size)} opens a ko; "
            f"{_word(context.color.opponent)} may not retake there immediately"
        ),
        salience=Salience.CRITICAL,
        points=(ko_point,),
    )


# ── Detectors: position ───────────────────────────────────────────────────────


def detect_line_number(context: DetectorContext) -> Finding | None:
    """Distance from the nearest edge, 1-indexed, so the edge itself is line 1.

    The number only. Which lines are low, territorial, or influence-oriented is a
    teaching point for the model, not a fact about the board.
    """
    point = context.point
    if point is None:
        return None
    size = context.board_size
    line = min(point.row, point.col, size - 1 - point.row, size - 1 - point.col) + 1
    return Finding(
        concept="line_number",
        label="Line",
        detail=f"{_name(point, size)} is on the {_ordinal(line)} line",
        salience=Salience.BACKGROUND,
        points=(point,),
    )


def _zone_of(point: Point, board_size: int) -> str:
    """Name the corner / side / centre region containing ``point``.

    The outer band is ``ceil(board_size / 3)`` lines deep on each edge, so it scales
    with the board: 7 lines on 19x19, 5 on 13x13, 3 on 9x9. A point inside the band
    on both axes is a corner, on exactly one axis a side, on neither the centre.
    The corner/side boundary is a convention, which is why this detector is marked
    heuristic.
    """
    band = -(-board_size // _ZONE_BAND_DIVISOR)
    vertical = "lower" if point.row < band else "upper" if point.row >= board_size - band else None
    horizontal = "left" if point.col < band else "right" if point.col >= board_size - band else None
    if vertical is not None and horizontal is not None:
        return f"{vertical}-{horizontal} corner"
    if vertical is not None:
        return f"{vertical} side"
    if horizontal is not None:
        return f"{horizontal} side"
    return "centre"


def detect_board_zone(context: DetectorContext) -> Finding | None:
    """Which region of the board the move was played in."""
    point = context.point
    if point is None:
        return None
    size = context.board_size
    return Finding(
        concept="board_zone",
        label="Zone",
        detail=f"{_name(point, size)} is in the {_zone_of(point, size)}",
        salience=Salience.BACKGROUND,
        certainty=Certainty.HEURISTIC,
        points=(point,),
    )


# ── Detectors: heuristics ─────────────────────────────────────────────────────


def detect_tenuki(context: DetectorContext) -> Finding | None:
    """The move is far from the opponent's previous move.

    Distance is a proxy, not a definition: a move can be four points away and still
    abandon the fight, or six away and be the direct answer to it. Fires at or
    beyond :data:`_TENUKI_MIN_DISTANCE` in Chebyshev distance.
    """
    point = context.point
    previous = context.previous_move
    if point is None or not isinstance(previous, Point):
        return None
    distance = max(abs(point.row - previous.row), abs(point.col - previous.col))
    if distance < _TENUKI_MIN_DISTANCE:
        return None
    size = context.board_size
    return Finding(
        concept="tenuki",
        label="Tenuki",
        detail=(
            f"{_name(point, size)} is {distance} points away from the opponent's previous "
            f"move at {_name(previous, size)}"
        ),
        salience=Salience.NOTABLE,
        certainty=Certainty.HEURISTIC,
        points=(previous,),
    )


def detect_game_phase(context: DetectorContext) -> Finding | None:
    """Opening, middlegame, or endgame, from how full the board is.

    Progress is ``max(move_number, stones on board) / intersections``. Stone count
    alone understates a game with heavy captures; move number alone ignores that a
    9x9 fills up four times faster than a 19x19. Taking the larger of the two keeps
    the phase from sliding backwards after a big capture.

    The boundaries are conventions and the detector is marked heuristic accordingly.
    """
    size = context.board_size
    intersections = size * size
    stones = sum(1 for _ in context.board_after.stones())
    progress = max(context.move_number, stones) / intersections
    if progress < _OPENING_MAX_PROGRESS:
        phase = "opening"
    elif progress < _MIDDLEGAME_MAX_PROGRESS:
        phase = "middlegame"
    else:
        phase = "endgame"
    return Finding(
        concept="game_phase",
        label="Phase",
        detail=(
            f"{phase} — move {context.move_number}, {stones} "
            f"{_plural(stones, 'stone', 'stones')} on a {size}x{size} board"
        ),
        salience=Salience.BACKGROUND,
        certainty=Certainty.HEURISTIC,
    )


# ── Registry ──────────────────────────────────────────────────────────────────

#: Every detector, in the order they are run. Position here breaks ties between
#: findings of equal salience, so the order is part of the output. Later tiers
#: append; they do not edit a dispatch chain.
DETECTORS: Final[tuple[Detector, ...]] = (
    # Critical
    detect_double_atari,
    detect_atari_given,
    detect_atari_ignored,
    detect_self_atari,
    detect_capture,
    detect_ko_capture,
    # Notable
    detect_contact_play,
    detect_connection,
    detect_extension,
    detect_tenuki,
    # Background
    detect_liberty_count,
    detect_line_number,
    detect_board_zone,
    detect_game_phase,
)


def run_detectors(
    context: DetectorContext, detectors: Sequence[Detector] | None = None
) -> tuple[Finding, ...]:
    """Run every detector and return what fired, most salient first.

    Findings whose concept is superseded by another that fired are dropped here, so
    no detector needs to know what any other detector found. Ties within a salience
    level keep :data:`DETECTORS` order, which makes the output deterministic.
    """
    registry = DETECTORS if detectors is None else tuple(detectors)
    fired: list[tuple[int, Finding]] = []
    for index, detector in enumerate(registry):
        finding = detector(context)
        if finding is not None:
            fired.append((index, finding))

    superseded = {concept for _, finding in fired for concept in finding.supersedes}
    kept = [pair for pair in fired if pair[1].concept not in superseded]
    kept.sort(key=lambda pair: (pair[1].salience, pair[0]))
    return tuple(finding for _, finding in kept)


# ── Renderer ──────────────────────────────────────────────────────────────────


def render_detected_features(
    findings: Sequence[Finding], *, max_lines: int = _MAX_FEATURE_LINES
) -> str:
    """Format findings as the prompt block, or return ``""`` when none fired.

    Deliberately generic: it sorts, caps, hedges heuristics, and aligns columns, and
    knows nothing about any individual concept. Truncation drops from the bottom,
    which is why salience is carried on the finding rather than decided here.

    An empty result is an empty string, not a bare header — a header promising
    detected features with nothing under it is worse than silence.
    """
    if max_lines < 1:
        raise ValueError(f"max_lines must be at least 1, got {max_lines}")
    if not findings:
        return ""

    shown = sorted(findings, key=lambda finding: finding.salience)[:max_lines]
    lines = [_FEATURE_HEADER]
    if any(finding.certainty is Certainty.HEURISTIC for finding in shown):
        lines.append(_HEURISTIC_NOTE)
    for finding in shown:
        suffix = "  (heuristic)" if finding.certainty is Certainty.HEURISTIC else ""
        lines.append(f"  {finding.label + ':':<{_LABEL_WIDTH}}{finding.detail}{suffix}")
    return "\n".join(lines) + "\n"
