"""Shared vocabulary for describing Go positions in prose.

Both the KataGo prompt builder and the concept detectors write about the same board
for the same reader, and they end up in the *same prompt*. When each kept its own
copy of this vocabulary, two blocks could drift into disagreeing about where "the
upper side" is — a contradiction the model has no way to resolve.

Deliberately dependency-free, so :mod:`app.services.concepts` can import it without
pulling in Anthropic, httpx, and application settings the way importing
:mod:`app.services.katago` would.
"""

from typing import Final

__all__ = ["REGION_NAMES", "ordinal"]

#: A 3x3 partition of the board, keyed by ``(vertical band, horizontal band)``.
#: Shared rather than agreed by convention: these names reach the model from two
#: different blocks, and the only way they cannot disagree is to be one table.
REGION_NAMES: Final[dict[tuple[str, str], str]] = {
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


def ordinal(n: int) -> str:
    """Return the ordinal string for ``n`` (e.g. ``1`` -> ``"1st"``)."""
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
