import asyncio
import functools
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import anthropic
import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, delete, select

from app.config import settings
from app.database import engine
from app.deps import CurrentUser, SessionDep
from app.errors import (
    ActiveJobExistsError,
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
    409: {
        "model": CommentaryErrorResponse,
        "description": "No Claude API key configured, or a review is already in progress",
    },
    429: {"model": CommentaryErrorResponse, "description": "Anthropic rate-limited the key"},
    502: {"model": CommentaryErrorResponse, "description": "KataGo or Anthropic failed"},
    500: {"model": CommentaryErrorResponse, "description": "Unexpected server error"},
}

# A dedicated, bounded pool for the KataGo + Anthropic pipeline — never Starlette's
# shared request threadpool. That pool has a fixed default capacity (40 slots) shared
# with every sync request handler and every sync BackgroundTask in the process; a
# handful of multi-minute commentary runs would exhaust it and stall unrelated
# requests, including a plain health check. Sizing this separately also caps how many
# concurrent analyses a single KataGo engine instance is asked to serve.
#
# Lazily created and recreated after a shutdown, mirroring ``katago.get_http_client``
# — the app lifespan's shutdown hook runs (and must run) every time a ``TestClient``
# context exits, not just at real process exit, so a plain module-level instance would
# be unusable for the rest of the test run after the first test tears it down.
_pipeline_executor: ThreadPoolExecutor | None = None
_pipeline_executor_lock = threading.Lock()


def _get_pipeline_executor() -> ThreadPoolExecutor:
    global _pipeline_executor
    if _pipeline_executor is None:
        with _pipeline_executor_lock:
            if _pipeline_executor is None:  # re-check: lost the race while waiting
                _pipeline_executor = ThreadPoolExecutor(
                    max_workers=settings.commentary_pipeline_workers,
                    thread_name_prefix="kifu-pipeline",
                )
    return _pipeline_executor


def close_pipeline_executor() -> None:
    """Called from the app lifespan on shutdown.

    ``wait=False`` so a graceful shutdown is not held open for however long an
    in-flight run has left; ``cancel_futures`` drops anything still queued but not yet
    started. Resets the global so the next call to ``_run_pipeline`` builds a fresh
    executor rather than submitting to a shut-down one.
    """
    global _pipeline_executor
    with _pipeline_executor_lock:
        if _pipeline_executor is not None:
            _pipeline_executor.shutdown(wait=False, cancel_futures=True)
            _pipeline_executor = None


async def _run_pipeline(*args: object, **kwargs: object) -> dict:
    """Run ``generate_commentary`` on the dedicated pipeline executor and await it.

    Keeps the multi-minute, CPU/network-bound call off both the event loop and
    Starlette's shared threadpool.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _get_pipeline_executor(), functools.partial(generate_commentary, *args, **kwargs)
    )


@router.get("/health/")
async def health() -> dict[str, str]:
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
async def commentary(
    payload: GenerateCommentaryRequest,
    user: CurrentUser,
    session: SessionDep,
) -> GenerateCommentaryResponse:
    """Generate commentary synchronously. Used by the web app.

    Browser extensions should use the job endpoints below instead — a Manifest V3
    service worker is killed if a single fetch takes longer than 30 seconds.
    """
    # ``session`` backs both this dependency and ``user`` (FastAPI resolves
    # ``Depends(get_session)`` once per request and shares it), and is not released
    # back to the pool until the endpoint returns — closing it explicitly here, before
    # the multi-minute pipeline call, is what actually frees the connection. Safe:
    # ``user``'s columns are already loaded, so it stays readable detached, and
    # ``Session.close()`` is idempotent — the dependency's own teardown closes it again
    # after this function returns.
    session.close()
    try:
        commentary = await _run_pipeline(
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

    with Session(engine) as fresh_session:
        _save_commentary(fresh_session, user.id, commentary)
    return commentary


def reap_abandoned_jobs() -> None:
    """Fail every job still ``queued``/``running`` from a previous process.

    Called once from the app lifespan, after ``init_db()``. A restart, deploy, or
    crash kills whatever thread was running a job with no chance to write a final
    status, so the row is left exactly where it was — indistinguishable, to a poller,
    from one that is still genuinely in progress. Without this, a client keeps polling
    a job nothing will ever finish until its own multi-minute client-side deadline.
    """
    now = datetime.now(UTC)
    with Session(engine) as session:
        abandoned = session.exec(
            select(CommentaryJob).where(CommentaryJob.status.in_(("queued", "running")))
        ).all()
        for job in abandoned:
            job.status = "failed"
            job.error_code = "job_abandoned"
            job.error_detail = "This review was interrupted by a server restart. Please try again."
            job.retry_after = None
            job.updated_at = now
            session.add(job)
        if abandoned:
            session.commit()
            logger.warning(
                "Marked %d abandoned commentary job(s) as failed on startup", len(abandoned)
            )


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


async def _run_commentary_job(
    job_id: str, user_id: int, payload: GenerateCommentaryRequest
) -> None:
    """Execute a queued job, after the 202 is sent.

    Runs on the event loop, awaiting the actual pipeline work on the dedicated
    executor (see ``_run_pipeline``) — never Starlette's shared request threadpool,
    which every sync route and every sync ``BackgroundTasks`` callable also draws
    from. The request-scoped session is long gone by the time a background task runs,
    so this owns its own sessions throughout, and — same reasoning as ``commentary()``
    above — never holds one open across the run itself.
    """
    # The whole run, including the initial fetch below, is inside this ``try`` — not
    # just the pipeline call — so a failure reaching *any* of it (e.g. a pool timeout
    # on the first ``session.get``) still writes a "failed" status. Without that, such
    # a failure would propagate out of a background task uncaught and leave the row at
    # "queued" forever, indistinguishable from one still genuinely in progress until
    # the startup reaper (``reap_abandoned_jobs``) catches it on the next restart.
    try:
        with Session(engine) as session:
            user = session.get(User, user_id)
            job = session.get(CommentaryJob, job_id)
            if user is None or job is None:
                logger.error("Job %s vanished before it could run", job_id)
                return
        # The session above is closed on exiting the ``with`` block. ``user`` is now
        # detached but its columns were already loaded, so the pipeline can still read
        # ``user.claude_api`` etc. without a live session for however long the run
        # takes.

        commentary = await _run_pipeline(
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
        with Session(engine) as session:
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

    with Session(engine) as session:
        _save_commentary(session, user_id, commentary)

        # Re-fetch: the progress callback has been writing to this row from its own
        # sessions throughout the run, so any earlier copy would be stale.
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
    # Captured before any commit below: ``session.commit()`` expires every object the
    # session has loaded, ``user`` included, not just the row(s) that commit touched —
    # so reading ``user.id`` after one, on a session we are about to close, would raise
    # ``DetachedInstanceError`` instead of returning the value.
    user_id = user.id

    # Prune this user's expired jobs opportunistically — no scheduler to depend on.
    cutoff = datetime.now(UTC) - COMMENTARY_JOB_RETENTION
    session.exec(
        delete(CommentaryJob)
        .where(CommentaryJob.user_id == user_id)
        .where(CommentaryJob.created_at < cutoff)
    )

    job = CommentaryJob(user_id=user_id, status="queued")
    session.add(job)
    try:
        session.commit()
    except IntegrityError:
        # The partial unique index on (user_id) WHERE status IN ('queued', 'running')
        # rejected this insert — enforced at the database, not just checked-then-
        # inserted, so two near-simultaneous requests can't both slip past a SELECT.
        session.rollback()
        # Report *which* run holds the slot. Without it the caller knows only that
        # it cannot start one, so its only move is to retry — and earn this same
        # 409 — where what it actually wants is to attach to the run in progress.
        # This is also how a review begun on one surface becomes visible on the
        # other: the web app and the extension share the slot, not the client state.
        active = session.exec(
            select(CommentaryJob)
            .where(CommentaryJob.user_id == user_id)
            .where(CommentaryJob.status.in_(("queued", "running")))
        ).first()
        raise ActiveJobExistsError(
            "You already have a commentary review in progress. Wait for it to finish "
            "before starting another.",
            job_id=active.id if active is not None else None,
        ) from None
    session.refresh(job)
    job_id = job.id
    # Same reasoning as ``commentary()`` above: the dependency-injected session is not
    # released back to the pool until this whole ASGI call finishes — which includes
    # the background task below, since it runs before the response's exit stack
    # unwinds. Closing explicitly here means the pipeline run doesn't hold it.
    session.close()

    background_tasks.add_task(_run_commentary_job, job_id, user_id, payload)
    return CommentaryJobCreatedResponse(job_id=job_id, status="queued")


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
