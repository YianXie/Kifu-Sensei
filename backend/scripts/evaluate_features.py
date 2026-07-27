"""Measure what the detected-features block actually adds to a game review.

Tier 3 is the last tier being built before the commentary is assessed, so this makes
the before/after comparison something to read rather than something to have an
impression about. It answers three questions:

1. How often does the block have anything in it at all?
2. How many findings does a typical move produce, before and after the eight-line cap?
3. Which detectors fire, and how often?

Question 3 is the one that should drive whether a Tier 4 happens. A detector that
fires on nearly every move is noise wearing a concept's name; one that never fires is
either broken or not earning its code.

A development tool, not part of the request path. Run it as::

    cd backend && PYTHONPATH=. uv run python scripts/evaluate_features.py GAME.sgf

Pass ``--analysis FILE.json`` to supply cached KataGo output — a JSON list of the
engine's per-turn responses, keyed by ``turnNumber``. Without it the Tier 2 detectors
stay silent by design (no ownership, no principal variations), and the Tier 1 and
Tier 3 frequencies are still exactly what they would be in a real run.

``--prompts N`` prints N side-by-side prompt comparisons, sampled across blunders,
quiet moves, and moves where nothing fired at all.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sgfmill import sgf

from app.services.board import (
    PASS,
    Board,
    Color,
    IllegalMoveError,
    Move,
    Point,
    point_to_go_notation,
)
from app.services.concepts import (
    _MAX_FEATURE_LINES,
    DETECTORS,
    DetectorContext,
    Finding,
    render_detected_features,
    run_detectors,
)

#: A move losing at least this much winrate counts as a blunder when sampling.
BLUNDER_DROP = 0.05


@dataclass(frozen=True, slots=True)
class MoveReview:
    """One move, its findings, and enough context to sample it later."""

    number: int
    color: Color
    move: Move
    findings: tuple[Finding, ...]
    winrate_drop: float | None

    board_size: int

    @property
    def label(self) -> str:
        if not isinstance(self.move, Point):
            return "pass"
        return point_to_go_notation(self.move, self.board_size)

    @property
    def is_blunder(self) -> bool:
        return self.winrate_drop is not None and self.winrate_drop >= BLUNDER_DROP


def _load_analysis(path: Path | None) -> dict[int, dict[str, Any]]:
    """Index cached KataGo responses by turn number, tolerating either shape."""
    if path is None:
        return {}
    payload = json.loads(path.read_text())
    entries = payload if isinstance(payload, list) else [payload]
    return {entry["turnNumber"]: entry for entry in entries if "turnNumber" in entry}


def _replay(
    sgf_bytes: bytes, analysis: dict[int, dict[str, Any]]
) -> tuple[list[MoveReview], int, int]:
    """Walk the game, running every detector on each move.

    Returns the reviews plus the counts of moves seen and moves skipped. A real SGF
    can contain a move this board rejects — out of turn, on an occupied point, an odd
    handicap encoding — and losing one move's findings is the right cost for that,
    rather than abandoning the whole review.
    """
    game = sgf.Sgf_game.from_bytes(sgf_bytes)
    size = game.get_size()
    root = game.get_root()

    black_setup, white_setup, _ = root.get_setup_stones()
    board = Board(size).place_setup_stones(
        black=[Point(row, col) for row, col in black_setup],
        white=[Point(row, col) for row, col in white_setup],
    )

    reviews: list[MoveReview] = []
    previous: Move | None = None
    seen = skipped = 0

    for number, node in enumerate(game.get_main_sequence()[1:], start=1):
        colour, played = node.get_move()
        if colour is None:
            continue
        seen += 1
        move: Move = PASS if played is None else Point(played[0], played[1])
        color = Color(colour)

        try:
            result = board.place_move(move, color)
        except IllegalMoveError:
            skipped += 1
            continue

        detail = analysis.get(number, {})
        before = analysis.get(number - 1, {})
        context = DetectorContext(
            board_before=board,
            result=result,
            move_number=number,
            previous_move=previous,
            root_info=detail.get("rootInfo"),
            move_infos=before.get("moveInfos"),
            ownership=detail.get("ownership"),
            root_info_before=before.get("rootInfo"),
            ownership_before=before.get("ownership"),
        )
        reviews.append(
            MoveReview(
                number=number,
                color=color,
                move=move,
                findings=run_detectors(context),
                winrate_drop=_winrate_drop(before, detail, color),
                board_size=size,
            )
        )
        board = result.board
        previous = move

    return reviews, seen, skipped


def _winrate_drop(before: dict[str, Any], after: dict[str, Any], color: Color) -> float | None:
    """How much winrate the mover lost. Both fields are Black-relative."""
    try:
        was = before["rootInfo"]["winrate"]
        now = after["rootInfo"]["winrate"]
    except KeyError:
        return None
    if color is Color.WHITE:
        was, now = 1.0 - was, 1.0 - now
    return was - now


def _sample(reviews: list[MoveReview], count: int) -> list[MoveReview]:
    """Pick a spread: blunders first, then quiet moves, then silent ones.

    Deliberately not random — an evaluation you cannot reproduce is an anecdote.
    """
    blunders = [r for r in reviews if r.is_blunder]
    silent = [r for r in reviews if not r.findings]
    quiet = [r for r in reviews if r.findings and not r.is_blunder]

    picked: list[MoveReview] = []
    for bucket in (blunders, quiet, silent):
        share = max(1, count // 3)
        step = max(1, len(bucket) // share) if bucket else 1
        picked.extend(bucket[::step][:share])
    return sorted(picked, key=lambda r: r.number)[:count]


def _print_comparison(review: MoveReview) -> None:
    block = render_detected_features(review.findings)
    print(f"\n{'=' * 78}")
    drop = f"{review.winrate_drop:+.1%}" if review.winrate_drop is not None else "n/a"
    print(f"Move {review.number} — {review.color.name} {review.label} (winrate {drop})")
    print("=" * 78)
    print("\n--- WITHOUT the detected-features block ---")
    print("  [GAME INFO] / [BOARD POSITION] / [KATAGO ANALYSIS DATA] unchanged\n")
    print("--- WITH the detected-features block ---")
    print(block if block else "  (nothing fired — the block is omitted entirely)\n")


def _print_statistics(reviews: list[MoveReview], seen: int, skipped: int) -> None:
    total = len(reviews)
    if not total:
        print("no reviewable moves")
        return

    non_empty = sum(1 for r in reviews if r.findings)
    raw = sum(len(r.findings) for r in reviews)
    capped = sum(min(len(r.findings), _MAX_FEATURE_LINES) for r in reviews)
    dropped = raw - capped

    print(f"\n{'=' * 78}")
    print("SUMMARY")
    print("=" * 78)
    print(f"  moves in game:            {seen}")
    if skipped:
        print(f"  moves skipped (illegal):  {skipped}")
    print(f"  moves reviewed:           {total}")
    print(f"  block non-empty:          {non_empty} ({non_empty / total:.0%})")
    print(f"  mean findings per move:   {raw / total:.2f} before the cap")
    print(f"                            {capped / total:.2f} after the cap")
    print(f"  findings dropped by cap:  {dropped} ({dropped / raw:.1%} of all findings)")

    counts = Counter(f.concept for r in reviews for f in r.findings)
    saliences = {f.concept: f.salience for r in reviews for f in r.findings}
    print(f"\n{'-' * 78}")
    print(f"  {'DETECTOR':<24}{'MOVES':>7}{'RATE':>8}  SALIENCE")
    print("-" * 78)
    for concept, count in counts.most_common():
        salience = saliences[concept].name.lower()
        print(f"  {concept:<24}{count:>7}{count / total:>7.0%}  {salience}")

    silent = [d.__name__.removeprefix("detect_") for d in DETECTORS]
    never = [name for name in silent if name not in counts and name != "move_ranking"]
    if never:
        print(f"\n  never fired: {', '.join(sorted(never))}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sgf", type=Path, help="the game to review")
    parser.add_argument(
        "--analysis", type=Path, default=None, help="cached KataGo responses (JSON)"
    )
    parser.add_argument(
        "--prompts", type=int, default=0, help="print N side-by-side prompt comparisons"
    )
    args = parser.parse_args(argv)

    analysis = _load_analysis(args.analysis)
    reviews, seen, skipped = _replay(args.sgf.read_bytes(), analysis)

    if args.prompts:
        for review in _sample(reviews, args.prompts):
            _print_comparison(review)
    _print_statistics(reviews, seen, skipped)
    if not analysis:
        print(
            "\n  note: no --analysis supplied, so the KataGo-derived detectors were "
            "silent by design."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
