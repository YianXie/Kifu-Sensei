import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


class FieldValidationError(Exception):
    """Raised to return DRF-style field errors: ``{"field": ["message", ...]}``."""

    def __init__(self, errors: dict[str, list[str]]):
        self.errors = errors
        super().__init__(str(errors))


class CommentaryError(Exception):
    """A commentary failure carrying a machine-readable code for clients to branch on.

    The commentary pipeline can fail for reasons the caller can act on (no API key,
    upstream rate limit) and reasons they cannot (KataGo down, a bug). Collapsing them
    into one status leaves clients string-matching the message, so each failure mode
    gets its own status and stable ``code``.
    """

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: str = "internal_error"

    def __init__(self, detail: str, *, retry_after: int | None = None) -> None:
        self.detail = detail
        self.retry_after = retry_after
        super().__init__(detail)


class MissingApiKeyError(CommentaryError):
    """The user triggered commentary without a stored Claude API key."""

    status_code = status.HTTP_409_CONFLICT
    code = "no_api_key"


class InvalidSgfError(CommentaryError):
    """The submitted SGF could not be parsed."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "invalid_sgf"


class UpstreamRateLimitedError(CommentaryError):
    """Anthropic rate-limited the user's API key."""

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "upstream_rate_limited"


class UpstreamAuthError(CommentaryError):
    """Anthropic rejected the user's API key."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "upstream_auth_failed"


class UpstreamError(CommentaryError):
    """Anthropic failed for a reason that is not the user's to fix."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "upstream_error"


class KatagoUnavailableError(CommentaryError):
    """The KataGo analysis engine was unreachable or returned an error."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "katago_unavailable"


class ActiveJobExistsError(CommentaryError):
    """The user already has a queued or running commentary job.

    Enforced at the database level (a partial unique index on ``commentary_jobs``),
    not just checked-then-inserted, so two near-simultaneous requests cannot both pass
    a plain SELECT check and both start a run.
    """

    status_code = status.HTTP_409_CONFLICT
    code = "job_already_running"


class CatchUnhandledErrors:
    """Turn an unhandled exception into a JSON 500 from *inside* the CORS middleware.

    Starlette's own ``ServerErrorMiddleware`` wraps everything registered with
    ``add_middleware``, so the bare 500 it produces on a crash never travels back out
    through ``CORSMiddleware`` and carries no ``Access-Control-Allow-Origin``. The
    browser then rejects the response as a cross-origin violation, and the console
    reports a CORS error for what is really a server bug — the status, the body, and
    the ``code`` are all invisible to the client, so the actual failure is impossible
    to see from the front end.

    Converting the exception here, underneath CORS, means the 500 is stamped like any
    other response and the real error reaches the caller.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception(
                "Unhandled error serving %s %s", scope.get("method"), scope.get("path")
            )
            if response_started:
                # The status line is already on the wire; there is no response left to
                # replace. Re-raise so the server tears the connection down rather than
                # appending a second body to a half-sent one.
                raise
            response = JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": "Internal server error.", "code": "internal_error"},
            )
            await response(scope, receive, send)


class MaxBodySizeMiddleware:
    """Reject a request whose declared ``Content-Length`` exceeds the configured cap.

    ``Field(max_length=...)`` on a request schema (e.g.
    ``GenerateCommentaryRequest.sgf_content``) only rejects *after* the whole body has
    already been read into memory — Pydantic validates a fully-parsed object, not a
    stream. Checking the header here, underneath everything else, means an honestly
    reported oversized body is refused before it is ever buffered. A client that lies
    about, or omits, ``Content-Length`` is not caught by this and falls back to the
    schema-level check once the body is fully read.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name != b"content-length":
                continue
            try:
                length = int(value)
            except ValueError:
                break
            if length > self.max_bytes:
                response = JSONResponse(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    content={"detail": "Request body is too large.", "code": "payload_too_large"},
                )
                await response(scope, receive, send)
                return
            break

        await self.app(scope, receive, send)


def _field_validation_handler(_: Request, exc: FieldValidationError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=exc.errors)


def _commentary_error_handler(_: Request, exc: CommentaryError) -> JSONResponse:
    # ``retry_after`` is echoed in the body so browser clients can read it without
    # CORS-exposing the header, and set as the standard header for everything else.
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code, "retry_after": exc.retry_after},
        headers=headers,
    )


def _request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Flatten FastAPI/Pydantic validation errors into DRF's ``{field: [msg]}`` shape."""
    errors: dict[str, list[str]] = {}
    for err in exc.errors():
        loc = [str(part) for part in err["loc"] if part not in ("body", "query", "path")]
        field = loc[-1] if loc else "non_field_errors"
        errors.setdefault(field, []).append(err["msg"])
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=errors)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(FieldValidationError, _field_validation_handler)
    app.add_exception_handler(RequestValidationError, _request_validation_handler)
    app.add_exception_handler(CommentaryError, _commentary_error_handler)
