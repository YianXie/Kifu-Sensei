from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


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
