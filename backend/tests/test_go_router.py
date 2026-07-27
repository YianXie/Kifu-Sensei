"""The commentary endpoints.

``generate_commentary`` is replaced throughout: these tests are about the router's
contract — error classification, persistence, ownership, job lifecycle — not about
KataGo or Claude, which ``test_katago_pipeline`` covers.
"""

from datetime import UTC, datetime, timedelta

import anthropic
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.errors import InvalidSgfError, MissingApiKeyError
from app.models import Commentary, CommentaryJob, User

REQUEST_BODY = {
    "sgf_content": "(;FF[4]GM[1]SZ[19];B[dd];W[pp])",
    "sgf_file_name": "game.sgf",
}

COMMENTARY_RESULT = {
    "board_size": 19,
    "sgf_file_name": "game.sgf",
    "language": "english",
    "model": "claude-sonnet-5",
    "usage": {
        "input_tokens": 120,
        "output_tokens": 45,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    },
    "moves": [["B", [15, 3]], ["W", [3, 15]]],
    "initial_stones": [],
    "comments": [{"turn": 1, "comment": "A calm opening.", "winrate_delta": -3.2, "color": "B"}],
    "annotated_sgf_content": "(;FF[4]GM[1]SZ[19];B[dd]C[A calm opening.];W[pp])",
}


@pytest.fixture
def stub_pipeline(monkeypatch: pytest.MonkeyPatch):
    """Replace ``generate_commentary`` with a recording stub.

    Patched on ``app.routers.go`` rather than on the service module because the
    router imported the name directly.
    """

    def _stub(*, returns: dict | None = None, raises: BaseException | None = None) -> list[dict]:
        calls: list[dict] = []

        def _fake(sgf_content: str, user: User, **kwargs) -> dict:
            calls.append({"sgf_content": sgf_content, "user_id": user.id, **kwargs})
            if raises is not None:
                raise raises
            return returns if returns is not None else COMMENTARY_RESULT

        monkeypatch.setattr("app.routers.go.generate_commentary", _fake)
        return calls

    return _stub


def _anthropic_error(cls, *, status_code: int, headers: dict | None = None):
    """Build an Anthropic SDK error without touching the network."""
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status_code, headers=headers or {}, request=request)
    return cls("upstream said no", response=response, body=None)


# ── Health ────────────────────────────────────────────────────────────────────


def test_health_is_public(client: TestClient) -> None:
    response = client.get("/api/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ── Synchronous commentary ────────────────────────────────────────────────────


def test_commentary_returns_the_pipeline_result(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline()
    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == 200
    assert response.json()["comments"][0]["comment"] == "A calm opening."


def test_commentary_requires_authentication(client: TestClient) -> None:
    assert client.post("/api/commentary/", json=REQUEST_BODY).status_code == 401


def test_commentary_forwards_the_configuration(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    calls = stub_pipeline()
    client.post(
        "/api/commentary/",
        headers=auth_headers,
        json={
            **REQUEST_BODY,
            "model": "claude-opus-5",
            "language": "japanese",
            "num_comments": 5,
            "max_token": 2048,
            "custom_instruction": "Focus on shape.",
        },
    )

    assert calls[0]["model"] == "claude-opus-5"
    assert calls[0]["language"] == "japanese"
    assert calls[0]["num_comments"] == 5
    assert calls[0]["max_token"] == 2048
    assert calls[0]["custom_instruction"] == "Focus on shape."


def test_commentary_applies_the_documented_defaults(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    calls = stub_pipeline()
    client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert calls[0]["model"] == "claude-sonnet-5"
    assert calls[0]["language"] == "english"
    assert calls[0]["num_comments"] == 20
    assert calls[0]["max_token"] == 1024


def test_commentary_is_saved_to_history(
    client: TestClient, session: Session, auth_headers: dict, user: User, stub_pipeline
) -> None:
    stub_pipeline()
    client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    saved = session.exec(select(Commentary).where(Commentary.user_id == user.id)).one()
    assert saved.sgf_file_name == "game.sgf"
    assert saved.model == "claude-sonnet-5"
    assert saved.annotated_sgf_content == COMMENTARY_RESULT["annotated_sgf_content"]


def test_a_history_write_failure_does_not_discard_the_result(
    client: TestClient, auth_headers: dict, stub_pipeline, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The run already cost KataGo time and Anthropic tokens."""
    stub_pipeline()

    def _explode(*args, **kwargs):
        raise RuntimeError("database is on fire")

    monkeypatch.setattr("app.routers.go.Commentary", _explode)

    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)
    assert response.status_code == 200


@pytest.mark.parametrize(
    ("exception", "status_code", "code"),
    [
        (MissingApiKeyError("no key"), 409, "no_api_key"),
        (InvalidSgfError("bad sgf"), 400, "invalid_sgf"),
        (httpx.ConnectError("katago is down"), 502, "katago_unavailable"),
        (RuntimeError("something unforeseen"), 500, "internal_error"),
    ],
)
def test_pipeline_failures_are_classified(
    client: TestClient,
    auth_headers: dict,
    stub_pipeline,
    exception: BaseException,
    status_code: int,
    code: str,
) -> None:
    stub_pipeline(raises=exception)
    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == status_code
    assert response.json()["code"] == code


def test_an_anthropic_rate_limit_becomes_a_429_with_retry_after(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline(
        raises=_anthropic_error(
            anthropic.RateLimitError, status_code=429, headers={"retry-after": "30"}
        )
    )
    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == 429
    assert response.json() == {
        "detail": "Anthropic is rate-limiting this API key.",
        "code": "upstream_rate_limited",
        "retry_after": 30,
    }
    assert response.headers["retry-after"] == "30"


def test_a_non_numeric_retry_after_is_dropped_rather_than_guessed(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    """The RFC also allows an HTTP-date; a bogus countdown is worse than none."""
    stub_pipeline(
        raises=_anthropic_error(
            anthropic.RateLimitError,
            status_code=429,
            headers={"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"},
        )
    )
    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == 429
    assert response.json()["retry_after"] is None


@pytest.mark.parametrize("cls", [anthropic.AuthenticationError, anthropic.PermissionDeniedError])
def test_a_rejected_api_key_becomes_upstream_auth_failed(
    client: TestClient, auth_headers: dict, stub_pipeline, cls
) -> None:
    stub_pipeline(raises=_anthropic_error(cls, status_code=401))
    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == 502
    assert response.json()["code"] == "upstream_auth_failed"


def test_other_anthropic_failures_become_upstream_error(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline(
        raises=anthropic.APIConnectionError(
            request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        )
    )
    response = client.post("/api/commentary/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == 502
    assert response.json()["code"] == "upstream_error"


@pytest.mark.parametrize(
    "body",
    [
        {"sgf_content": "", "sgf_file_name": "game.sgf"},
        {"sgf_content": "(;FF[4])", "sgf_file_name": "a.s"},
        {**REQUEST_BODY, "model": "gpt-4"},
        {**REQUEST_BODY, "language": "klingon"},
        {**REQUEST_BODY, "num_comments": 0},
        {**REQUEST_BODY, "num_comments": 101},
        {**REQUEST_BODY, "max_token": 255},
        {**REQUEST_BODY, "max_token": 8193},
        {**REQUEST_BODY, "custom_instruction": "x" * 1001},
    ],
)
def test_out_of_range_requests_are_rejected_before_the_pipeline_runs(
    client: TestClient, auth_headers: dict, stub_pipeline, body: dict
) -> None:
    calls = stub_pipeline()
    response = client.post("/api/commentary/", headers=auth_headers, json=body)

    assert response.status_code == 400
    assert calls == []


# ── Job endpoints ─────────────────────────────────────────────────────────────
#
# TestClient runs background tasks synchronously once the response is sent, so a
# POST here returns only after ``_run_commentary_job`` has finished.


def test_creating_a_job_returns_202_and_an_id(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline()
    response = client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY)

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert response.json()["job_id"]


def test_a_job_reaches_succeeded_and_carries_the_result(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline()
    job_id = client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY).json()[
        "job_id"
    ]

    response = client.get(f"/api/commentary/jobs/{job_id}/", headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded"
    assert body["error"] is None
    assert body["result"]["comments"][0]["comment"] == "A calm opening."
    assert body["progress"] == {"done": 1, "total": 1}


def test_a_succeeded_job_is_also_written_to_history(
    client: TestClient, session: Session, auth_headers: dict, user: User, stub_pipeline
) -> None:
    stub_pipeline()
    client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY)

    assert session.exec(select(Commentary).where(Commentary.user_id == user.id)).one()


def test_progress_callbacks_are_published(
    client: TestClient, auth_headers: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The job runner passes ``on_progress`` down so a poller sees real counts."""
    seen: list[tuple[int, int]] = []

    def _fake(sgf_content: str, user: User, *, on_progress=None, **kwargs) -> dict:
        assert on_progress is not None
        on_progress(3, 7)
        seen.append((3, 7))
        return COMMENTARY_RESULT

    monkeypatch.setattr("app.routers.go.generate_commentary", _fake)
    client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY)

    assert seen == [(3, 7)]


def test_a_failed_job_records_the_error_code(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline(raises=MissingApiKeyError("This account has no Claude API key configured."))
    job_id = client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY).json()[
        "job_id"
    ]

    body = client.get(f"/api/commentary/jobs/{job_id}/", headers=auth_headers).json()

    assert body["status"] == "failed"
    assert body["result"] is None
    assert body["error"]["code"] == "no_api_key"
    assert body["error"]["detail"] == "This account has no Claude API key configured."


def test_a_rate_limited_job_records_retry_after(
    client: TestClient, auth_headers: dict, stub_pipeline
) -> None:
    stub_pipeline(
        raises=_anthropic_error(
            anthropic.RateLimitError, status_code=429, headers={"retry-after": "17"}
        )
    )
    job_id = client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY).json()[
        "job_id"
    ]

    body = client.get(f"/api/commentary/jobs/{job_id}/", headers=auth_headers).json()

    assert body["error"]["code"] == "upstream_rate_limited"
    assert body["error"]["retry_after"] == 17


def test_polling_an_unknown_job_is_a_404(client: TestClient, auth_headers: dict) -> None:
    assert client.get("/api/commentary/jobs/nope/", headers=auth_headers).status_code == 404


def test_another_users_job_is_reported_as_missing(
    client: TestClient, session: Session, auth_headers: dict, make_user, stub_pipeline
) -> None:
    """404 rather than 403, so job ids cannot be probed for existence."""
    stub_pipeline()
    other = make_user("other@example.com")
    foreign = CommentaryJob(user_id=other.id, status="succeeded")
    session.add(foreign)
    session.commit()
    session.refresh(foreign)

    response = client.get(f"/api/commentary/jobs/{foreign.id}/", headers=auth_headers)
    assert response.status_code == 404


def test_creating_a_job_prunes_this_users_expired_jobs(
    client: TestClient, session: Session, auth_headers: dict, user: User, stub_pipeline
) -> None:
    stub_pipeline()
    stale = CommentaryJob(
        user_id=user.id,
        status="succeeded",
        created_at=datetime.now(UTC) - timedelta(hours=48),
    )
    fresh = CommentaryJob(user_id=user.id, status="succeeded")
    session.add(stale)
    session.add(fresh)
    session.commit()
    stale_id, fresh_id = stale.id, fresh.id

    client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY)

    session.expunge_all()
    assert session.get(CommentaryJob, stale_id) is None
    assert session.get(CommentaryJob, fresh_id) is not None


def test_pruning_leaves_another_users_expired_jobs_alone(
    client: TestClient, session: Session, auth_headers: dict, make_user, stub_pipeline
) -> None:
    stub_pipeline()
    other = make_user("other@example.com")
    theirs = CommentaryJob(
        user_id=other.id,
        status="succeeded",
        created_at=datetime.now(UTC) - timedelta(hours=48),
    )
    session.add(theirs)
    session.commit()
    theirs_id = theirs.id

    client.post("/api/commentary/jobs/", headers=auth_headers, json=REQUEST_BODY)

    session.expunge_all()
    assert session.get(CommentaryJob, theirs_id) is not None


def test_creating_a_job_requires_authentication(client: TestClient) -> None:
    assert client.post("/api/commentary/jobs/", json=REQUEST_BODY).status_code == 401


def test_polling_a_job_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/commentary/jobs/anything/").status_code == 401
