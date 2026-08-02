from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session

from app.database import get_session
from app.models import User
from app.security import ACCESS_TOKEN_TYPE, decode_token

_bearer = HTTPBearer(auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentication credentials were not provided or are invalid.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[Session, Depends(get_session)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _CREDENTIALS_EXCEPTION
    try:
        payload = decode_token(credentials.credentials, ACCESS_TOKEN_TYPE)
        user_id = int(payload["sub"])
        token_version = payload["token_version"]
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise _CREDENTIALS_EXCEPTION from None

    user = session.get(User, user_id)
    # A version mismatch means this token predates a password change or an explicit
    # logout (see routers.auth.logout) — reject it exactly like an unknown user,
    # rather than authenticating a session the user asked to end.
    if user is None or token_version != user.token_version:
        raise _CREDENTIALS_EXCEPTION
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
SessionDep = Annotated[Session, Depends(get_session)]
