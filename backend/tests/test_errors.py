"""The exception handlers, exercised against a throwaway app.

Building a small app here rather than reaching for a real endpoint keeps each test
pinned to one handler, and lets ``CommentaryError`` subclasses be raised directly
instead of by driving the whole commentary pipeline into failure.
"""

import logging

import pytest
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.errors import (
    CatchUnhandledErrors,
    CommentaryError,
    FieldValidationError,
    InvalidSgfError,
    KatagoUnavailableError,
    MaxBodySizeMiddleware,
    MissingApiKeyError,
    UpstreamAuthError,
    UpstreamError,
    UpstreamRateLimitedError,
    register_exception_handlers,
)

ORIGIN = "http://localhost:5173"


class _Payload(BaseModel):
    name: str
    count: int = Field(ge=1)


@pytest.fixture
def error_client() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/field-error/")
    def _field_error() -> None:
        raise FieldValidationError({"email": ["Already taken."]})

    @app.get("/commentary-error/{code}")
    def _commentary_error(code: str) -> None:
        raise {
            "no_api_key": lambda: MissingApiKeyError("No key."),
            "invalid_sgf": lambda: InvalidSgfError("Bad SGF."),
            "rate_limited": lambda: UpstreamRateLimitedError("Slow down.", retry_after=42),
            "rate_limited_no_header": lambda: UpstreamRateLimitedError("Slow down."),
            "auth": lambda: UpstreamAuthError("Rejected."),
            "upstream": lambda: UpstreamError("Unreachable."),
            "katago": lambda: KatagoUnavailableError("Engine down."),
            "generic": lambda: CommentaryError("Failed."),
        }[code]()

    @app.post("/validated/")
    def _validated(payload: _Payload) -> dict:
        return {"ok": True, "name": payload.name}

    return TestClient(app, raise_server_exceptions=False)


def test_field_validation_errors_use_the_drf_shape(error_client: TestClient) -> None:
    response = error_client.get("/field-error/")
    assert response.status_code == 400
    assert response.json() == {"email": ["Already taken."]}


@pytest.mark.parametrize(
    ("path", "status_code", "code"),
    [
        ("no_api_key", 409, "no_api_key"),
        ("invalid_sgf", 400, "invalid_sgf"),
        ("rate_limited", 429, "upstream_rate_limited"),
        ("auth", 502, "upstream_auth_failed"),
        ("upstream", 502, "upstream_error"),
        ("katago", 502, "katago_unavailable"),
        ("generic", 500, "internal_error"),
    ],
)
def test_each_commentary_error_maps_to_its_own_status_and_code(
    error_client: TestClient, path: str, status_code: int, code: str
) -> None:
    """Clients branch on ``code``; collapsing these would force message matching."""
    response = error_client.get(f"/commentary-error/{path}")
    assert response.status_code == status_code
    assert response.json()["code"] == code


def test_retry_after_is_sent_as_both_a_header_and_a_body_field(
    error_client: TestClient,
) -> None:
    """Browsers cannot read the header without a CORS expose rule, so the body
    carries it too."""
    response = error_client.get("/commentary-error/rate_limited")
    assert response.headers["retry-after"] == "42"
    assert response.json()["retry_after"] == 42


def test_retry_after_is_omitted_when_upstream_did_not_supply_one(
    error_client: TestClient,
) -> None:
    response = error_client.get("/commentary-error/rate_limited_no_header")
    assert "retry-after" not in response.headers
    assert response.json()["retry_after"] is None


def test_commentary_error_body_carries_the_detail(error_client: TestClient) -> None:
    assert error_client.get("/commentary-error/katago").json()["detail"] == "Engine down."


def test_request_validation_errors_are_flattened_to_field_lists(
    error_client: TestClient,
) -> None:
    response = error_client.post("/validated/", json={"count": 0})

    assert response.status_code == 400
    body = response.json()
    assert set(body) == {"name", "count"}
    assert isinstance(body["name"], list)
    assert isinstance(body["count"], list)


def test_request_validation_strips_the_body_prefix_from_field_names(
    error_client: TestClient,
) -> None:
    """``loc`` is ``("body", "name")``; clients want just ``name``."""
    response = error_client.post("/validated/", json={"count": 3})
    assert "name" in response.json()
    assert "body" not in response.json()


def test_a_validation_error_with_no_field_is_labelled_non_field_errors(
    error_client: TestClient,
) -> None:
    response = error_client.post(
        "/validated/", content="not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert "non_field_errors" in response.json() or "body" not in response.json()


# ── Unhandled errors ──────────────────────────────────────────────────────────


@pytest.fixture
def crashing_client() -> TestClient:
    """An app wired exactly like ``app.main``: CORS outside, error catcher inside."""
    app = FastAPI()
    register_exception_handlers(app)
    app.add_middleware(CatchUnhandledErrors)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/crash/")
    def _crash() -> None:
        raise RuntimeError("column commentaries.model does not exist")

    return TestClient(app, raise_server_exceptions=False)


def test_an_unhandled_error_returns_a_json_500(crashing_client: TestClient) -> None:
    response = crashing_client.get("/crash/")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error.", "code": "internal_error"}


def test_an_unhandled_error_keeps_its_cors_headers(crashing_client: TestClient) -> None:
    """Without this the browser reports a server crash as a CORS failure, and the
    status and body never reach the client at all."""
    response = crashing_client.get("/crash/", headers={"Origin": ORIGIN})
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_an_unhandled_error_does_not_leak_the_exception(crashing_client: TestClient) -> None:
    assert "column commentaries.model" not in crashing_client.get("/crash/").text


def test_an_unhandled_error_is_logged_with_its_traceback(
    crashing_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """The client gets a generic message, so the traceback has to reach the logs."""
    with caplog.at_level(logging.ERROR, logger="app.errors"):
        crashing_client.get("/crash/")

    record = next(r for r in caplog.records if r.name == "app.errors")
    assert record.exc_info is not None
    assert "GET" in record.getMessage() and "/crash/" in record.getMessage()


def test_error_subclasses_keep_their_class_attributes() -> None:
    assert MissingApiKeyError("x").code == "no_api_key"
    assert MissingApiKeyError("x").status_code == 409
    assert UpstreamRateLimitedError("x", retry_after=5).retry_after == 5
    assert CommentaryError("x").retry_after is None


# ── Max body size ────────────────────────────────────────────────────────────


@pytest.fixture
def size_limited_client() -> TestClient:
    """An app wired exactly like ``app.main``: CORS outermost, wrapping the size
    guard, so its 413 gets CORS headers the same way an unhandled 500 does."""
    app = FastAPI()
    register_exception_handlers(app)
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=10)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/echo/")
    async def _echo(request: Request) -> dict:
        body = await request.body()
        return {"received": len(body)}

    return TestClient(app, raise_server_exceptions=False)


def test_a_body_within_the_limit_is_accepted(size_limited_client: TestClient) -> None:
    response = size_limited_client.post("/echo/", content=b"short")
    assert response.status_code == 200
    assert response.json() == {"received": 5}


def test_a_body_over_the_limit_is_rejected_by_content_length(
    size_limited_client: TestClient,
) -> None:
    response = size_limited_client.post("/echo/", content=b"this body is over ten bytes")
    assert response.status_code == 413
    assert response.json() == {"detail": "Request body is too large.", "code": "payload_too_large"}


def test_the_oversized_response_keeps_its_cors_headers(size_limited_client: TestClient) -> None:
    response = size_limited_client.post(
        "/echo/", content=b"this body is over ten bytes", headers={"Origin": ORIGIN}
    )
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_a_non_http_scope_is_passed_through_untouched() -> None:
    """The middleware must not misinterpret a lifespan/websocket scope as a request
    with no Content-Length to check."""
    app = FastAPI()
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=10)

    @app.get("/ok/")
    def _ok() -> dict:
        return {"ok": True}

    with TestClient(app) as client:
        assert client.get("/ok/").json() == {"ok": True}
