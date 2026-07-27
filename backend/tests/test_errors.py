"""The exception handlers, exercised against a throwaway app.

Building a small app here rather than reaching for a real endpoint keeps each test
pinned to one handler, and lets ``CommentaryError`` subclasses be raised directly
instead of by driving the whole commentary pipeline into failure.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app.errors import (
    CommentaryError,
    FieldValidationError,
    InvalidSgfError,
    KatagoUnavailableError,
    MissingApiKeyError,
    UpstreamAuthError,
    UpstreamError,
    UpstreamRateLimitedError,
    register_exception_handlers,
)


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


def test_error_subclasses_keep_their_class_attributes() -> None:
    assert MissingApiKeyError("x").code == "no_api_key"
    assert MissingApiKeyError("x").status_code == 409
    assert UpstreamRateLimitedError("x", retry_after=5).retry_after == 5
    assert CommentaryError("x").retry_after is None
