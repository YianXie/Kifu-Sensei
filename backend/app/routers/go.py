import logging
from datetime import UTC, datetime

import anthropic
import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlmodel import Session, delete, select

from app.database import engine
from app.deps import CurrentUser, SessionDep
from app.errors import (
    CommentaryError,
    KatagoUnavailableError,
    UpstreamAuthError,
    UpstreamError,
    UpstreamRateLimitedError,
)
from app.models import COMMENTARY_JOB_RETENTION, Commentary, CommentaryJob, User
from app.schemas import (
    CommentaryErrorResponse,
    CommentaryJobCreatedResponse,
    CommentaryJobProgress,
    CommentaryJobStatusResponse,
    GenerateCommentaryRequest,
    GenerateCommentaryResponse,
)
from app.services.katago import generate_commentary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["go"])

_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    400: {"model": CommentaryErrorResponse, "description": "The SGF could not be parsed"},
    409: {"model": CommentaryErrorResponse, "description": "No Claude API key configured"},
    429: {"model": CommentaryErrorResponse, "description": "Anthropic rate-limited the key"},
    502: {"model": CommentaryErrorResponse, "description": "KataGo or Anthropic failed"},
    500: {"model": CommentaryErrorResponse, "description": "Unexpected server error"},
}


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


def _to_commentary_error(exc: BaseException) -> CommentaryError:
    """Classify a pipeline failure into a client-actionable error.

    Shared by the synchronous endpoint and the background job runner so the two cannot
    drift apart. Order matters: ``anthropic.APIError`` is the base class of the two
    Anthropic checks above it, and the Anthropic checks come before ``httpx`` because
    the SDK wraps its own transport failures in ``APIConnectionError`` — a raw httpx
    error therefore only ever comes from the KataGo client.
    """
    if isinstance(exc, CommentaryError):
        return exc
    if isinstance(exc, anthropic.RateLimitError):
        return UpstreamRateLimitedError(
            "Anthropic is rate-limiting this API key.",
            retry_after=_retry_after_seconds(exc),
        )
    if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
        return UpstreamAuthError("Anthropic rejected this API key.")
    if isinstance(exc, anthropic.APIError):
        logger.warning("Anthropic call failed: %s", exc)
        return UpstreamError("Claude could not be reached. Please try again.")
    if isinstance(exc, httpx.HTTPError):
        logger.warning("KataGo call failed: %s", exc)
        return KatagoUnavailableError("The analysis engine is unavailable.")
    logger.exception("Unexpected failure generating commentary", exc_info=exc)
    return CommentaryError("Failed to generate commentary.")


def _save_commentary(session: Session, user_id: int, commentary: dict) -> None:
    """Append the run to the user's history.

    Failures are logged and swallowed: the run has already cost KataGo time and
    Anthropic tokens, so a history-write problem must not discard the result.
    """
    try:
        session.add(
            Commentary(
                user_id=user_id,
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


@router.post("/commentary/", response_model=GenerateCommentaryResponse, responses=_ERROR_RESPONSES)
def commentary(
    payload: GenerateCommentaryRequest,
    user: CurrentUser,
    session: SessionDep,
) -> GenerateCommentaryResponse:
    """Generate commentary synchronously. Used by the web app.

    Browser extensions should use the job endpoints below instead — a Manifest V3
    service worker is killed if a single fetch takes longer than 30 seconds.
    """
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
    except Exception as exc:
        raise _to_commentary_error(exc) from exc

    _save_commentary(session, user.id, commentary)
    return commentary


def _set_job_progress(job_id: str, done: int, total: int) -> None:
    """Publish progress from inside the pipeline.

    Uses its own short-lived session per update rather than holding one open for the
    whole run, so a multi-minute job never keeps a write transaction open against the
    rows the polling requests are reading.
    """
    try:
        with Session(engine) as session:
            job = session.get(CommentaryJob, job_id)
            if job is None:
                return
            job.status = "running"
            job.progress_done = done
            job.progress_total = total
            job.updated_at = datetime.now(UTC)
            session.add(job)
            session.commit()
    except Exception:
        # Progress is cosmetic; never let it abort a run that is otherwise fine.
        logger.exception("Could not record progress for job %s", job_id)


def _run_commentary_job(job_id: str, user_id: int, payload: GenerateCommentaryRequest) -> None:
    """Execute a queued job. Runs in Starlette's threadpool, after the 202 is sent.

    Owns its own session and re-loads the user: the request-scoped session is closed
    once the response goes out, so the ORM instance from the request is unusable here.
    """
    with Session(engine) as session:
        user = session.get(User, user_id)
        job = session.get(CommentaryJob, job_id)
        if user is None or job is None:
            logger.error("Job %s vanished before it could run", job_id)
            return

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
                on_progress=lambda done, total: _set_job_progress(job_id, done, total),
            )
        except Exception as exc:
            error = _to_commentary_error(exc)
            job = session.get(CommentaryJob, job_id)
            if job is not None:
                job.status = "failed"
                job.error_code = error.code
                job.error_detail = error.detail
                job.retry_after = error.retry_after
                job.updated_at = datetime.now(UTC)
                session.add(job)
                session.commit()
            return

        _save_commentary(session, user_id, commentary)

        # Re-fetch: the progress callback has been writing to this row from its own
        # sessions, so the instance loaded above is stale.
        job = session.get(CommentaryJob, job_id)
        if job is None:
            return
        job.status = "succeeded"
        job.result = commentary
        job.progress_done = len(commentary["comments"])
        job.progress_total = len(commentary["comments"])
        job.updated_at = datetime.now(UTC)
        session.add(job)
        session.commit()


@router.post(
    "/commentary/jobs/",
    response_model=CommentaryJobCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_commentary_job(
    payload: GenerateCommentaryRequest,
    user: CurrentUser,
    session: SessionDep,
    background_tasks: BackgroundTasks,
) -> CommentaryJobCreatedResponse:
    """Queue a commentary run and return immediately with a job id to poll."""
    # Prune this user's expired jobs opportunistically — no scheduler to depend on.
    cutoff = datetime.now(UTC) - COMMENTARY_JOB_RETENTION
    session.exec(
        delete(CommentaryJob)
        .where(CommentaryJob.user_id == user.id)
        .where(CommentaryJob.created_at < cutoff)
    )

    job = CommentaryJob(user_id=user.id, status="queued")
    session.add(job)
    session.commit()
    session.refresh(job)

    background_tasks.add_task(_run_commentary_job, job.id, user.id, payload)
    return CommentaryJobCreatedResponse(job_id=job.id, status="queued")


@router.get("/commentary/jobs/{job_id}/", response_model=CommentaryJobStatusResponse)
def get_commentary_job(
    job_id: str,
    user: CurrentUser,
    session: SessionDep,
) -> CommentaryJobStatusResponse:
    """Poll a job. Someone else's job is reported as missing, not forbidden."""
    job = session.exec(
        select(CommentaryJob)
        .where(CommentaryJob.id == job_id)
        .where(CommentaryJob.user_id == user.id)
    ).first()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    error = None
    if job.status == "failed":
        error = CommentaryErrorResponse(
            detail=job.error_detail or "Failed to generate commentary.",
            code=job.error_code or "internal_error",
            retry_after=job.retry_after,
        )

    return CommentaryJobStatusResponse(
        job_id=job.id,
        status=job.status,
        progress=CommentaryJobProgress(done=job.progress_done, total=job.progress_total),
        result=job.result,
        error=error,
    )
