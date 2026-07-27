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
httpx, and settings at import time). Detectors consume KataGo output that a caller
already fetched; they never call the engine.

Adding a detector in a later tier means writing a function and appending it to
:data:`DETECTORS`. Nothing else changes: the renderer holds no per-concept
knowledge, so there is no dispatch chain to edit.

KataGo conventions, verified empirically
----------------------------------------
The Tier 2 detectors read a neural-network estimate delivered over a JSON protocol
with its own orientation and perspective conventions. Getting those wrong fails
*silently and plausibly*: a transposed ownership map still yields well-formed
numbers, and the feature block tells the model it may state them as fact. So they
were measured against the real engine rather than assumed, using a position whose
answer distinguishes transposition from row and column inversion — Black sealing the
upper-left corner and White the lower-right, two corners that exchange under
transposition:

* **Ownership array order** — row-major with the **first row at the top** of the
  board. With our bottom-origin rows that is ``(size - 1 - row) * size + col``.
  Measured: the Black-walled upper-left read ``+0.989`` and the White-walled
  lower-right ``-0.989``, where a transposed read would have given ``-0.989``, a
  row-inverted read ``-0.472``, and a column-inverted read ``+0.577``.
* **Ownership sign and perspective** — positive is **Black**, and the values are
  Black-relative, not mover-relative: re-running the identical position with White
  to move left the upper-left at ``+0.987`` instead of flipping it.
* **``rootInfo.winrate`` and ``rootInfo.scoreLead``** — also Black-relative. In a
  position where Black was overwhelmingly ahead, both stayed pinned to Black
  (``1.0000`` / ``+161.5`` with Black to play, ``1.0000`` / ``+148.8`` with White to
  play) rather than inverting with the mover.

Every reading of that array goes through :class:`OwnershipMap`, so the conventions
live in exactly one place. :meth:`OwnershipMap.for_color` converts to the *owner's*
perspective, which is the framing that matters: a Black chain sitting in strongly
White ownership is a dying Black group, not "White territory".
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
    InvalidCoordinateError,
    Move,
    MoveResult,
    Point,
    point_from_go_notation,
    point_to_go_notation,
)

__all__ = [
    "DETECTORS",
    "Certainty",
    "Detector",
    "DetectorContext",
    "Finding",
    "OwnershipLengthError",
    "OwnershipMap",
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

# -- Tier 2: KataGo-derived thresholds ----------------------------------------
#
# The pipeline runs a shallow pass (50 visits) over every move and a deep pass
# (500 visits) over only the ~20-30 largest winrate drops, so ownership and usable
# principal variations exist for a minority of moves. Below the visit floor these
# detectors stay silent: a missing finding costs nothing, while a fabricated one
# breaks the block's promise that everything inside it is certified fact.

#: Root visits below which ownership and PV estimates are treated as too noisy to
#: report. Sits between the two passes' visit counts, so the shallow pass never
#: reaches an ownership detector.
_MIN_RELIABLE_VISITS: Final = 100

#: Owner-relative mean ownership at or above which a chain reads as settled, and at
#: or below which it reads as dying. Between the two it is unsettled.
_SETTLED_MIN: Final = 0.60
_DYING_MAX: Final = -0.60

#: Owner-relative settledness change smaller than this is noise, not a finding.
_SETTLEDNESS_CHANGE_MIN: Final = 0.15

#: Chebyshev distance within which another chain counts as "nearby" the played move,
#: and the most chains one settledness finding will spell out.
_NEARBY_CHAIN_DISTANCE: Final = 4
_MAX_CHAINS_REPORTED: Final = 3

#: Fraction of the board by which the largest area must beat the played area before
#: the gap counts as substantial (and the finding is promoted to critical). A
#: fraction rather than a flat count: a 9x9 region holds at most 9 points, so any
#: absolute threshold near 10 could never be reached there.
_LARGEST_AREA_GAP_FRACTION: Final = 0.03

#: Local ownership swing, in points, below which the move did not visibly change
#: who holds its neighbourhood.
_LOCAL_SWING_MIN: Final = 1.5

#: Divisor setting the local box radius: a 5x5 box on 19x19 and 13x13, 3x3 on 9x9.
_LOCAL_BOX_DIVISOR: Final = 8

#: Chebyshev distance within which the opponent's PV reply counts as a local answer,
#: making the move locally sente.
_SENTE_MAX_DISTANCE: Final = 4

#: Only the opponent's immediate reply is used. PVs degrade with depth — the tenth
#: move of a line is close to speculative — so nothing here reads past index 1.
_PV_REPLY_INDEX: Final = 1

_LABEL_WIDTH: Final = 18

_FEATURE_HEADER: Final = (
    "[DETECTED FEATURES — computed from the board, not inferred. You may state these as fact.]"
)
#: Heuristic findings lead with this rather than carrying a trailing tag. The header
#: promises everything below may be stated as fact, and a threshold-based regional
#: estimate is computed but is not the same kind of fact as a liberty count. Putting
#: the hedge first means the qualifier is read before the claim it qualifies.
_HEURISTIC_PREFIX: Final = "estimated — "
_HEURISTIC_NOTE: Final = (
    'Lines beginning "estimated —" rest on tuned thresholds rather than exact '
    "computation. Hedge them or leave them out; state the rest plainly."
)


# ── Ownership ─────────────────────────────────────────────────────────────────


class OwnershipLengthError(ValueError):
    """A KataGo ownership array does not match the board it claims to describe.

    Raised rather than tolerated. A length mismatch is a protocol or wiring fault,
    not absent data: silently indexing into it would place every subsequent claim
    about territory on the wrong points, and the block would present those claims as
    fact. Missing data is a different situation and produces silence instead.
    """


@dataclass(frozen=True, slots=True)
class OwnershipMap:
    """KataGo's flat ownership array, addressable by :class:`Point`.

    The single place the array's orientation and sign conventions are encoded — both
    verified against the live engine, see the module docstring. Every detector reads
    ownership through here so that a convention change is one edit, not fourteen.

    Raw values are Black-relative in ``[-1, 1]``. Prefer :meth:`for_color`, which
    converts to the perspective of whoever owns the stones being discussed.
    """

    values: tuple[float, ...]
    board_size: int

    @classmethod
    def build(cls, values: Sequence[float], board_size: int) -> OwnershipMap:
        expected = board_size * board_size
        if len(values) != expected:
            raise OwnershipLengthError(
                f"ownership array has {len(values)} entries but a {board_size}x{board_size} "
                f"board has {expected} points"
            )
        return cls(values=tuple(values), board_size=board_size)

    def _index(self, point: Point) -> int:
        """Row-major from the top row. Our row 0 is the bottom, so it is inverted."""
        return (self.board_size - 1 - point.row) * self.board_size + point.col

    def at(self, point: Point) -> float:
        """Black-relative ownership: positive leans Black, negative leans White."""
        return self.values[self._index(point)]

    def for_color(self, point: Point, color: Color) -> float:
        """Ownership from ``color``'s perspective: positive means ``color`` holds it.

        The same number means opposite things to the two players, which is the whole
        point. A Black chain sitting at ``-0.9`` Black-relative is a Black group
        about to die, and calling that "White territory" would describe the position
        correctly while missing what actually happened.
        """
        value = self.at(point)
        return value if color is Color.BLACK else -value

    def mean_for(self, points: Iterable[Point], color: Color) -> float:
        """Mean owner-relative ownership over ``points``.

        Averaging the engine's own scalar over a group's stones substitutes for a
        life-and-death solver: near ``+1`` the group is alive, near ``-1`` it is
        being captured, and near ``0`` it is genuinely unsettled.
        """
        collected = list(points)
        if not collected:
            raise ValueError("cannot take the mean ownership of no points")
        return sum(self.for_color(point, color) for point in collected) / len(collected)


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

    Which position each KataGo field describes is easy to get backwards, so it is
    spelled out here rather than left to the caller's memory:

    * ``root_info`` / ``ownership`` — the position **after** the move, i.e. the
      pipeline's ``detail`` for this turn.
    * ``root_info_before`` / ``ownership_before`` — the position **before** it, the
      pipeline's ``prev_detail``. Needed by the two detectors that compare.
    * ``move_infos`` — KataGo's ranked candidates for the position **before** the
      move, so they are the alternatives to what was played. Keeping the protocol's
      own field name; the position it describes is the trap.

    All of them are optional. The deep analysis pass covers only the ~20-30 biggest
    winrate drops, so most moves arrive with no ownership at all.
    """

    board_before: Board
    result: MoveResult
    move_number: int
    previous_move: Move | None = None
    root_info: Mapping[str, Any] | None = None
    move_infos: Sequence[Mapping[str, Any]] | None = None
    ownership: Sequence[float] | None = None
    root_info_before: Mapping[str, Any] | None = None
    ownership_before: Sequence[float] | None = None

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

    def _reliable_map(
        self, values: Sequence[float] | None, root: Mapping[str, Any] | None
    ) -> OwnershipMap | None:
        """Build an ownership map, or return ``None`` if it should not be trusted.

        Absent data and low-visit data are both answered with ``None`` here, in one
        place, so no detector has to remember to check either. A malformed array
        still raises — that is a fault, not a gap.
        """
        if values is None:
            return None
        visits = (root or {}).get("visits", 0)
        if not isinstance(visits, int | float) or visits < _MIN_RELIABLE_VISITS:
            return None
        return OwnershipMap.build(values, self.board_size)

    @property
    def ownership_map(self) -> OwnershipMap | None:
        """Ownership after the move, or ``None`` when missing or too noisy."""
        return self._reliable_map(self.ownership, self.root_info)

    @property
    def ownership_map_before(self) -> OwnershipMap | None:
        """Ownership before the move, or ``None`` when missing or too noisy."""
        return self._reliable_map(self.ownership_before, self.root_info_before)


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
    root_info_before: Mapping[str, Any] | None = None,
    ownership_before: Sequence[float] | None = None,
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
        root_info_before=root_info_before,
        ownership_before=ownership_before,
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
    """Name the corner / side / center region containing ``point``.

    The outer band is ``ceil(board_size / 3)`` lines deep on each edge, so it scales
    with the board: 7 lines on 19x19, 5 on 13x13, 3 on 9x9. A point inside the band
    on both axes is a corner, on exactly one axis a side, on neither the center.
    The corner/side boundary is a convention, which is why this detector is marked
    heuristic.

    Distinct from :func:`_region_of`, which cuts the board into even thirds to answer
    a different question — where the play *is* versus where the biggest area *is*.
    Both spell it "center", matching the ownership-summary block in
    :mod:`app.services.katago`, so nothing in the prompt disagrees about the word.
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
    return "center"


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


# ── Tier 2 helpers: regions, distance, PV parsing ─────────────────────────────

#: A 3x3 partition of the board, named as :mod:`app.services.katago` already names
#: it in the ownership-summary block. Sharing the vocabulary matters more than
#: picking a better one: two blocks in the same prompt that disagree about where
#: "the upper side" is would be a contradiction the model has no way to resolve.
_REGION_NAMES: Final[dict[tuple[str, str], str]] = {
    ("upper", "left"): "upper-left",
    ("upper", "center"): "upper side",
    ("upper", "right"): "upper-right",
    ("center", "left"): "left side",
    ("center", "center"): "center",
    ("center", "right"): "right side",
    ("lower", "left"): "lower-left",
    ("lower", "center"): "lower side",
    ("lower", "right"): "lower-right",
}


def _chebyshev(a: Point, b: Point) -> int:
    return max(abs(a.row - b.row), abs(a.col - b.col))


def _region_bands(board_size: int) -> tuple[int, int]:
    """Split points into thirds. Scales to any board: 6/12 on 19x19, 3/6 on 9x9."""
    return board_size // 3, (2 * board_size) // 3


def _region_of(point: Point, board_size: int) -> str:
    """Name the 3x3 region containing ``point``. Row 0 is the bottom of the board."""
    first, second = _region_bands(board_size)
    vertical = "lower" if point.row < first else "upper" if point.row >= second else "center"
    horizontal = "left" if point.col < first else "right" if point.col >= second else "center"
    return _REGION_NAMES[(vertical, horizontal)]


def _contested_by_region(ownership: OwnershipMap, board_size: int) -> dict[str, float]:
    """Score each region by how much of it is still up for grabs.

    A point contributes ``1 - |ownership|``, so a dead-settled point adds nothing and
    a genuinely undecided one adds a full point. The total reads directly as "about
    this many points are still contested here", which is the comparison a kyu player
    needs and the one the model can state without inventing a number.
    """
    totals: dict[str, float] = {name: 0.0 for name in _REGION_NAMES.values()}
    for row in range(board_size):
        for col in range(board_size):
            point = Point(row, col)
            totals[_region_of(point, board_size)] += 1.0 - abs(ownership.at(point))
    return totals


def _local_box_radius(board_size: int) -> int:
    """Radius of the neighbourhood box: 2 (5x5) on 19x19 and 13x13, 1 (3x3) on 9x9."""
    return max(1, round(board_size / _LOCAL_BOX_DIVISOR))


def _box_points(centre: Point, radius: int, board_size: int) -> tuple[Point, ...]:
    return tuple(
        Point(row, col)
        for row in range(max(0, centre.row - radius), min(board_size, centre.row + radius + 1))
        for col in range(max(0, centre.col - radius), min(board_size, centre.col + radius + 1))
    )


def _played_candidate(context: DetectorContext) -> Mapping[str, Any] | None:
    """The engine's entry for the move actually played, if it was a candidate.

    A bad enough move falls outside a truncated candidate list, and that is a fact
    about the move rather than an error — callers get ``None`` and say so.
    """
    if not context.move_infos or context.point is None:
        return None
    played = point_to_go_notation(context.point, context.board_size)
    for info in context.move_infos:
        if str(info.get("move", "")).upper() == played:
            return info
    return None


def _pv_reply(info: Mapping[str, Any], board_size: int) -> Point | None:
    """The opponent's immediate reply in a candidate's principal variation.

    Only index :data:`_PV_REPLY_INDEX` is read. A pass, a malformed coordinate, or a
    PV too short to contain a reply all yield ``None``.
    """
    pv = info.get("pv")
    if not isinstance(pv, Sequence) or isinstance(pv, str | bytes):
        return None
    if len(pv) <= _PV_REPLY_INDEX:
        return None
    try:
        return point_from_go_notation(str(pv[_PV_REPLY_INDEX]), board_size)
    except InvalidCoordinateError:
        return None  # "pass" and anything malformed


def _settledness_band(value: float) -> str:
    if value >= _SETTLED_MIN:
        return "settled"
    if value <= _DYING_MAX:
        return "dying"
    return "unsettled"


# ── Tier 2 detectors: KataGo-derived ──────────────────────────────────────────


def _chains_to_report(context: DetectorContext) -> tuple[Chain, ...]:
    """The played chain, then nearby chains of either colour, nearest first."""
    played = context.point
    if played is None:
        return ()
    ordered: list[Chain] = []
    if context.result.chain_after is not None:
        ordered.append(context.result.chain_after)
    nearby: list[tuple[int, Chain]] = []
    for chain in context.board_after.chains():
        if chain in ordered:
            continue
        distance = min(_chebyshev(point, played) for point in chain.points)
        if distance <= _NEARBY_CHAIN_DISTANCE:
            nearby.append((distance, chain))
    nearby.sort(key=lambda pair: (pair[0], min(pair[1].points)))
    ordered.extend(chain for _, chain in nearby)
    return tuple(ordered[:_MAX_CHAINS_REPORTED])


def detect_group_settledness(context: DetectorContext) -> Finding | None:
    """Mean ownership across each nearby chain, read from that chain's own side.

    This is what makes the tier worth building: averaging a scalar the engine
    already produces stands in for a life-and-death solver, and "your group here was
    still unsettled" becomes something the model can say with confidence.

    The number reported is owner-relative, so ``-0.8`` on a White chain means White's
    stones are dying, not that Black is doing badly.
    """
    ownership = context.ownership_map
    if ownership is None:
        return None
    chains = _chains_to_report(context)
    if not chains:
        return None

    size = context.board_size
    parts: list[str] = []
    friendly_at_risk = False
    points: list[Point] = []
    for chain in chains:
        value = ownership.mean_for(chain.points, chain.color)
        band = _settledness_band(value)
        if chain.color is context.color and band != "settled":
            friendly_at_risk = True
        points.extend(chain.points)
        parts.append(f"{_word(chain.color)} at {_names(chain.points, size)} {value:+.2f} ({band})")
    return Finding(
        concept="group_settledness",
        label="Settledness",
        detail="; ".join(parts) + " — each value is from that group's own side",
        salience=Salience.CRITICAL if friendly_at_risk else Salience.BACKGROUND,
        points=tuple(sorted(set(points))),
    )


def detect_settledness_change(context: DetectorContext) -> Finding | None:
    """How much the move shifted ownership of the chain it produced.

    Measured over the same points in both positions. Ownership is defined for empty
    intersections too, so the played point contributes its pre-move estimate, and the
    reading is "how did this area's ownership change" rather than a comparison
    between two different groups.
    """
    after = context.ownership_map
    before = context.ownership_map_before
    chain = context.result.chain_after
    if after is None or before is None or chain is None:
        return None

    color = context.color
    delta = after.mean_for(chain.points, color) - before.mean_for(chain.points, color)
    if abs(delta) < _SETTLEDNESS_CHANGE_MIN:
        return None
    direction = "more settled for" if delta > 0 else "less settled for"
    size = context.board_size
    return Finding(
        concept="settledness_change",
        label="Settledness Δ",
        detail=(
            f"the group at {_names(chain.points, size)} became {direction} {_word(color)} "
            f"({delta:+.2f} owner-relative)"
        ),
        salience=Salience.NOTABLE,
        points=tuple(sorted(chain.points)),
    )


def detect_direction_of_play(context: DetectorContext) -> Finding | None:
    """Which region of the board holds the most still-undecided ownership.

    The 3x3 partition is a convention, not a fact about Go, so the finding is
    heuristic. The contested totals underneath it are measured.
    """
    ownership = context.ownership_map
    if ownership is None:
        return None
    totals = _contested_by_region(ownership, context.board_size)
    name, score = max(totals.items(), key=lambda item: (item[1], item[0]))
    return Finding(
        concept="direction_of_play",
        label="Biggest area",
        detail=f"the {name} holds the most undecided ownership, roughly {score:.0f} points",
        salience=Salience.NOTABLE,
        certainty=Certainty.HEURISTIC,
    )


def detect_move_in_largest_area(context: DetectorContext) -> Finding | None:
    """Whether the move went to the largest contested region, and by how much it missed.

    Playing a small move while a much larger area sits open is the most common
    kyu-level mistake, and it is two comparisons on top of the ownership map. Phrased
    as measured sizes rather than a verdict — the move may be a forced local answer,
    which this layer cannot see.
    """
    ownership = context.ownership_map
    point = context.point
    if ownership is None or point is None:
        return None

    size = context.board_size
    totals = _contested_by_region(ownership, size)
    largest_name, largest_score = max(totals.items(), key=lambda item: (item[1], item[0]))
    played_name = _region_of(point, size)
    played_score = totals[played_name]

    if played_name == largest_name:
        detail = (
            f"{_name(point, size)} is in the {played_name}, which is also the most "
            f"contested region (~{played_score:.0f} points)"
        )
        salience = Salience.NOTABLE
    else:
        gap = largest_score - played_score
        detail = (
            f"{_name(point, size)} is in the {played_name} (~{played_score:.0f} contested "
            f"points) while the {largest_name} holds ~{largest_score:.0f}, "
            f"a difference of ~{gap:.0f}"
        )
        substantial = gap >= _LARGEST_AREA_GAP_FRACTION * size * size
        salience = Salience.CRITICAL if substantial else Salience.NOTABLE
    return Finding(
        concept="move_in_largest_area",
        label="Area choice",
        detail=detail,
        salience=salience,
        certainty=Certainty.HEURISTIC,
        points=(point,),
    )


def detect_local_ownership_swing(context: DetectorContext) -> Finding | None:
    """Total ownership change in a box around the played point, before versus after."""
    after = context.ownership_map
    before = context.ownership_map_before
    point = context.point
    if after is None or before is None or point is None:
        return None

    size = context.board_size
    radius = _local_box_radius(size)
    box = _box_points(point, radius, size)
    color = context.color
    swing = sum(after.for_color(p, color) - before.for_color(p, color) for p in box)
    if abs(swing) < _LOCAL_SWING_MIN:
        return None
    direction = "toward" if swing > 0 else "away from"
    width = radius * 2 + 1
    return Finding(
        concept="local_ownership_swing",
        label="Local swing",
        detail=(
            f"ownership in the {width}x{width} area around {_name(point, size)} moved "
            f"{swing:+.1f} points {direction} {_word(color)}"
        ),
        salience=Salience.NOTABLE,
        points=(point,),
    )


def detect_sente_gote(context: DetectorContext) -> Finding | None:
    """Whether the engine's line has the opponent answering locally.

    A proxy, not a proof: one principal variation is a single continuation, not a
    demonstration that the opponent has to answer. Only the immediate reply is read,
    and the finding is heuristic.
    """
    played = _played_candidate(context)
    point = context.point
    if played is None or point is None:
        return None
    visits = (context.root_info_before or {}).get("visits", 0)
    if not isinstance(visits, int | float) or visits < _MIN_RELIABLE_VISITS:
        return None
    reply = _pv_reply(played, context.board_size)
    if reply is None:
        return None

    size = context.board_size
    distance = _chebyshev(point, reply)
    local = distance <= _SENTE_MAX_DISTANCE
    shape = "locally sente" if local else "locally gote"
    where = "nearby at" if local else "elsewhere at"
    return Finding(
        concept="sente_gote",
        label="Sente/gote",
        detail=(
            f"in the engine's line the opponent answers {where} {_name(reply, size)}, "
            f"{distance} {_plural(distance, 'point', 'points')} away — {shape}"
        ),
        salience=Salience.NOTABLE,
        certainty=Certainty.HEURISTIC,
        points=(reply,),
    )


def detect_move_ranking(context: DetectorContext) -> Finding | None:
    """Where the played move sat among the engine's candidates.

    **Not in** :data:`DETECTORS` by design. The ``[KATAGO ANALYSIS DATA]`` block
    already renders rank, policy prior, and the not-a-candidate case, and two blocks
    computing the same value independently is how a prompt ends up contradicting
    itself. Kept and exported so the wiring can switch homes for these values in one
    place if that block is ever slimmed down.
    """
    if not context.move_infos or context.point is None:
        return None
    size = context.board_size
    played = _played_candidate(context)
    if played is None:
        return Finding(
            concept="move_ranking",
            label="Move rank",
            detail=(
                f"{_name(context.point, size)} is outside the engine's top "
                f"{len(context.move_infos)} candidates"
            ),
            salience=Salience.BACKGROUND,
            points=(context.point,),
        )
    order = played.get("order")
    rank = _ordinal(order + 1) if isinstance(order, int) else "unranked"
    detail = f"{_name(context.point, size)} is the engine's {rank} choice"
    prior = played.get("prior")
    if isinstance(prior, int | float):
        detail += f", policy prior {prior:.3f}"
    return Finding(
        concept="move_ranking",
        label="Move rank",
        detail=detail,
        salience=Salience.BACKGROUND,
        points=(context.point,),
    )


# ── Registry ──────────────────────────────────────────────────────────────────

#: Every detector, in the order they are run. Position here breaks ties between
#: findings of equal salience, so the order is part of the output. Later tiers
#: append; they do not edit a dispatch chain.
#: ``detect_move_ranking`` is deliberately absent — see its docstring; rank and
#: policy prior already have a home in the ``[KATAGO ANALYSIS DATA]`` block.
DETECTORS: Final[tuple[Detector, ...]] = (
    # Tier 1 — exact, from stone geometry
    detect_double_atari,
    detect_atari_given,
    detect_atari_ignored,
    detect_self_atari,
    detect_capture,
    detect_ko_capture,
    detect_contact_play,
    detect_connection,
    detect_extension,
    detect_tenuki,
    detect_liberty_count,
    detect_line_number,
    detect_board_zone,
    detect_game_phase,
    # Tier 2 — from KataGo's estimates. Salience varies per finding: an unsettled
    # friendly group or a badly missed area is critical, the same detectors are
    # background when the news is unremarkable.
    detect_group_settledness,
    detect_move_in_largest_area,
    detect_settledness_change,
    detect_local_ownership_swing,
    detect_sente_gote,
    detect_direction_of_play,
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
        prefix = _HEURISTIC_PREFIX if finding.certainty is Certainty.HEURISTIC else ""
        lines.append(f"  {finding.label + ':':<{_LABEL_WIDTH}}{prefix}{finding.detail}")
    return "\n".join(lines) + "\n"
