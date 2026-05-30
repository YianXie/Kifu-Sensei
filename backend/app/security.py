from datetime import UTC, datetime
from uuid import uuid4

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher

from app.config import settings

_password_hash = PasswordHash((BcryptHasher(),))

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _password_hash.verify(password, hashed)


def _create_token(user_id: int, email: str, token_type: str, lifetime) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": token_type,
        "iat": now,
        "exp": now + lifetime,
        "jti": uuid4().hex,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, email: str) -> str:
    return _create_token(user_id, email, ACCESS_TOKEN_TYPE, settings.access_token_lifetime)


def create_refresh_token(user_id: int, email: str) -> str:
    return _create_token(user_id, email, REFRESH_TOKEN_TYPE, settings.refresh_token_lifetime)


def decode_token(token: str, expected_type: str) -> dict:
    """Decode and validate a JWT, raising ``jwt.InvalidTokenError`` on failure."""
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload
