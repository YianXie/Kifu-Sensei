from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import settings
from app.security import (
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_password_does_not_store_the_plaintext(
    hashed_test_password: str, test_password: str
) -> None:
    assert test_password not in hashed_test_password
    assert hashed_test_password.startswith("$2b$")


def test_verify_password_accepts_the_right_password(
    hashed_test_password: str, test_password: str
) -> None:
    assert verify_password(test_password, hashed_test_password) is True


def test_verify_password_rejects_the_wrong_password(hashed_test_password: str) -> None:
    assert verify_password("wrong-password", hashed_test_password) is False


def test_hashes_are_salted() -> None:
    """Two users with the same password must not share a hash."""
    assert hash_password("shared") != hash_password("shared")


def test_access_token_carries_the_expected_claims() -> None:
    token = create_access_token(7, "player@example.com", 3)
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])

    assert payload["sub"] == "7"
    assert payload["email"] == "player@example.com"
    assert payload["token_version"] == 3
    assert payload["type"] == ACCESS_TOKEN_TYPE
    assert payload["exp"] > payload["iat"]
    assert payload["jti"]


def test_token_version_defaults_to_zero() -> None:
    """Callers that don't care about revocation (most of the test suite) still mint a
    token with a well-defined version rather than an absent claim."""
    token = create_access_token(1, "a@b.com")
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    assert payload["token_version"] == 0


def test_refresh_token_is_tagged_as_a_refresh_token() -> None:
    payload = decode_token(create_refresh_token(1, "a@b.com"), REFRESH_TOKEN_TYPE)
    assert payload["type"] == REFRESH_TOKEN_TYPE


def test_tokens_have_unique_jtis() -> None:
    first = decode_token(create_access_token(1, "a@b.com"), ACCESS_TOKEN_TYPE)
    second = decode_token(create_access_token(1, "a@b.com"), ACCESS_TOKEN_TYPE)
    assert first["jti"] != second["jti"]


def test_refresh_token_outlives_the_access_token() -> None:
    access = decode_token(create_access_token(1, "a@b.com"), ACCESS_TOKEN_TYPE)
    refresh = decode_token(create_refresh_token(1, "a@b.com"), REFRESH_TOKEN_TYPE)
    assert refresh["exp"] > access["exp"]


def test_decode_rejects_a_token_of_the_wrong_type() -> None:
    """A refresh token must not be usable as an access token, or vice versa."""
    refresh = create_refresh_token(1, "a@b.com")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(refresh, ACCESS_TOKEN_TYPE)


def test_decode_rejects_a_token_signed_with_another_key() -> None:
    forged = jwt.encode(
        {
            "sub": "1",
            "type": ACCESS_TOKEN_TYPE,
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        "an-attacker-controlled-key",
        algorithm="HS256",
    )
    with pytest.raises(jwt.InvalidSignatureError):
        decode_token(forged, ACCESS_TOKEN_TYPE)


def test_decode_rejects_an_expired_token() -> None:
    expired = jwt.encode(
        {
            "sub": "1",
            "type": ACCESS_TOKEN_TYPE,
            "exp": datetime.now(UTC) - timedelta(seconds=1),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_token(expired, ACCESS_TOKEN_TYPE)


def test_decode_rejects_an_unsigned_token() -> None:
    """``alg: none`` must not be accepted."""
    unsigned = jwt.encode({"sub": "1", "type": ACCESS_TOKEN_TYPE}, key="", algorithm="none")
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(unsigned, ACCESS_TOKEN_TYPE)


def test_decode_rejects_a_tampered_payload() -> None:
    token = create_access_token(1, "a@b.com")
    header, payload, signature = token.split(".")
    tampered = f"{header}.{payload[:-2]}XY.{signature}"
    with pytest.raises(jwt.InvalidTokenError):
        decode_token(tampered, ACCESS_TOKEN_TYPE)
