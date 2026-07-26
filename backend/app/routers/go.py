import logging

import anthropic
import httpx
from fastapi import APIRouter

from app.deps import CurrentUser, SessionDep
from app.errors import (
    CommentaryError,
    KatagoUnavailableError,
    UpstreamAuthError,
    UpstreamError,
    UpstreamRateLimitedError,
)
from app.models import Commentary
from app.schemas import (
    CommentaryErrorResponse,
    GenerateCommentaryRequest,
    GenerateCommentaryResponse,
)
from app.services.katago import generate_commentary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["go"])


@router.get("/health/")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _retry_after_seconds(exc: anthropic.APIStatusError) -> int | None:
    """Read the ``retry-after`` header off an Anthropic error, in whole seconds.

    Anthropic sends a number of seconds. The RFC also allows an HTTP-date, which we do
    not translate — returning ``None`` lets the client fall back to generic wording
    rather than show a nonsense countdown.
    """
    response = getattr(exc, "response", None)
    raw = response.headers.get("retry-after") if response is not None else None
    if raw is None:
        return None
    try:
        return max(0, int(float(raw)))
    except (TypeError, ValueError):
        return None


@router.post(
    "/commentary/",
    response_model=GenerateCommentaryResponse,
    responses={
        400: {"model": CommentaryErrorResponse, "description": "The SGF could not be parsed"},
        409: {"model": CommentaryErrorResponse, "description": "No Claude API key configured"},
        429: {"model": CommentaryErrorResponse, "description": "Anthropic rate-limited the key"},
        502: {"model": CommentaryErrorResponse, "description": "KataGo or Anthropic failed"},
        500: {"model": CommentaryErrorResponse, "description": "Unexpected server error"},
    },
)
def commentary(
    payload: GenerateCommentaryRequest,
    user: CurrentUser,
    session: SessionDep,
) -> GenerateCommentaryResponse:
    try:
        commentary = generate_commentary(
            payload.sgf_content,
            user,
            model=payload.model,
            sgf_file_name=payload.sgf_file_name,
            language=payload.language,
            num_comments=payload.num_comments,
            max_token=payload.max_token,
            custom_instruction=payload.custom_instruction,
        )
    except CommentaryError:
        # Already carries its own status and code (no_api_key, invalid_sgf).
        raise
    except anthropic.RateLimitError as exc:
        raise UpstreamRateLimitedError(
            "Anthropic is rate-limiting this API key.",
            retry_after=_retry_after_seconds(exc),
        ) from exc
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
        raise UpstreamAuthError("Anthropic rejected this API key.") from exc
    except anthropic.APIError as exc:
        # Base class for the rest of the Anthropic SDK's errors, including connection
        # failures — must stay below the specific handlers above.
        logger.warning("Anthropic call failed: %s", exc)
        raise UpstreamError("Claude could not be reached. Please try again.") from exc
    except httpx.HTTPError as exc:
        # Only the KataGo client raises raw httpx errors; the Anthropic SDK wraps its
        # own in APIError, which is handled above.
        logger.warning("KataGo call failed: %s", exc)
        raise KatagoUnavailableError("The analysis engine is unavailable.") from exc
    except Exception as exc:
        logger.exception("Unexpected failure generating commentary")
        raise CommentaryError("Failed to generate commentary.") from exc

    # Persisted outside the block above: the run has already cost the user KataGo time
    # and Anthropic tokens, so a history-write failure must not throw the result away.
    try:
        session.add(
            Commentary(
                user_id=user.id,
                board_size=commentary["board_size"],
                sgf_file_name=commentary["sgf_file_name"],
                language=commentary["language"],
                model=commentary["model"],
                usage=commentary["usage"],
                moves=commentary["moves"],
                initial_stones=commentary["initial_stones"],
                comments=commentary["comments"],
                annotated_sgf_content=commentary["annotated_sgf_content"],
            )
        )
        session.commit()
    except Exception:
        logger.exception("Generated commentary but failed to save it to history")
        session.rollback()

    return commentary
