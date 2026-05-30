from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class FieldValidationError(Exception):
    """Raised to return DRF-style field errors: ``{"field": ["message", ...]}``."""

    def __init__(self, errors: dict[str, list[str]]):
        self.errors = errors
        super().__init__(str(errors))


def _field_validation_handler(_: Request, exc: FieldValidationError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=exc.errors)


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
