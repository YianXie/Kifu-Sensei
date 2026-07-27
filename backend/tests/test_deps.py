"""Authentication of protected routes, exercised through ``GET /auth/user/settings/``."""

from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.config import settings
from app.models import User
from app.security import ACCESS_TOKEN_TYPE, create_access_token, create_refresh_token

SETTINGS_URL = "/auth/user/settings/"


def test_a_valid_access_token_is_accepted(client: TestClient, auth_headers: dict) -> None:
    assert client.get(SETTINGS_URL, headers=auth_headers).status_code == 200


def test_a_missing_authorization_header_is_rejected(client: TestClient) -> None:
    assert client.get(SETTINGS_URL).status_code == 401


def test_a_non_bearer_scheme_is_rejected(client: TestClient, user: User) -> None:
    token = create_access_token(user.id, user.email)
    response = client.get(SETTINGS_URL, headers={"Authorization": f"Basic {token}"})
    assert response.status_code == 401


def test_the_bearer_scheme_is_matched_case_insensitively(client: TestClient, user: User) -> None:
    token = create_access_token(user.id, user.email)
    response = client.get(SETTINGS_URL, headers={"Authorization": f"bearer {token}"})
    assert response.status_code == 200


def test_a_garbage_token_is_rejected(client: TestClient) -> None:
    response = client.get(SETTINGS_URL, headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


def test_an_expired_token_is_rejected(client: TestClient, user: User) -> None:
    expired = jwt.encode(
        {
            "sub": str(user.id),
            "type": ACCESS_TOKEN_TYPE,
            "exp": datetime.now(UTC) - timedelta(minutes=1),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    response = client.get(SETTINGS_URL, headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401


def test_a_refresh_token_cannot_authenticate_a_request(client: TestClient, user: User) -> None:
    """Refresh tokens are long-lived; accepting one as an access token would
    silently extend the access-token lifetime to seven days."""
    refresh = create_refresh_token(user.id, user.email)
    response = client.get(SETTINGS_URL, headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 401


def test_a_token_signed_with_another_key_is_rejected(client: TestClient, user: User) -> None:
    forged = jwt.encode(
        {
            "sub": str(user.id),
            "type": ACCESS_TOKEN_TYPE,
            "exp": datetime.now(UTC) + timedelta(minutes=30),
        },
        "an-attacker-controlled-key",
        algorithm="HS256",
    )
    response = client.get(SETTINGS_URL, headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401


def test_a_token_for_a_deleted_user_is_rejected(
    client: TestClient, session: Session, user: User
) -> None:
    headers = {"Authorization": f"Bearer {create_access_token(user.id, user.email)}"}
    session.delete(user)
    session.commit()

    assert client.get(SETTINGS_URL, headers=headers).status_code == 401


def test_a_non_numeric_subject_is_rejected(client: TestClient) -> None:
    token = jwt.encode(
        {
            "sub": "not-an-id",
            "type": ACCESS_TOKEN_TYPE,
            "exp": datetime.now(UTC) + timedelta(minutes=30),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    response = client.get(SETTINGS_URL, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_a_token_without_a_subject_is_rejected(client: TestClient) -> None:
    token = jwt.encode(
        {"type": ACCESS_TOKEN_TYPE, "exp": datetime.now(UTC) + timedelta(minutes=30)},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    response = client.get(SETTINGS_URL, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_the_challenge_header_is_advertised(client: TestClient) -> None:
    response = client.get(SETTINGS_URL)
    assert response.headers["www-authenticate"] == "Bearer"
