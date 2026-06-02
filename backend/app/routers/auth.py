import jwt
from fastapi import APIRouter, HTTPException, Response, status
from sqlmodel import select

from app.crypto import encrypt_secret
from app.deps import CurrentUser, SessionDep
from app.errors import FieldValidationError
from app.models import User
from app.schemas import (
    AccessTokenResponse,
    DetailResponse,
    RegisterRequest,
    TokenObtainRequest,
    TokenPairResponse,
    TokenRefreshRequest,
    DeleteAccountRequest,
    UpdateClaudeApiKeyRequest,
    UpdateEmailRequest,
    UpdatePasswordRequest,
    UserPublic,
    UserSettingsSchema,
)
from app.security import (
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_pair(user: User) -> TokenPairResponse:
    return TokenPairResponse(
        access=create_access_token(user.id, user.email),
        refresh=create_refresh_token(user.id, user.email),
        user=UserPublic(
            id=user.id,
            email=user.email,
            preferences=user.preferences,
            has_claude_api_key=user.has_claude_api_key,
        ),
    )


@router.post(
    "/register/",
    status_code=status.HTTP_201_CREATED,
    response_model=DetailResponse,
)
def register(payload: RegisterRequest, session: SessionDep) -> DetailResponse:
    email = payload.email.lower()
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing is not None:
        raise FieldValidationError({"email": ["A user with this email already exists."]})

    user = User(email=email, hashed_password=hash_password(payload.password))
    session.add(user)
    session.commit()
    return DetailResponse(detail="Account created.")


@router.post("/token/", response_model=TokenPairResponse)
def token_obtain(payload: TokenObtainRequest, session: SessionDep) -> TokenPairResponse:
    email = payload.email.lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No active account found with the given credentials.",
        )
    return _token_pair(user)


@router.post("/token/refresh/", response_model=AccessTokenResponse)
def token_refresh(payload: TokenRefreshRequest, session: SessionDep) -> AccessTokenResponse:
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is invalid or expired."
    )
    try:
        claims = decode_token(payload.refresh, REFRESH_TOKEN_TYPE)
        user_id = int(claims["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise invalid from None

    user = session.get(User, user_id)
    if user is None:
        raise invalid

    return AccessTokenResponse(
        access=create_access_token(user.id, user.email),
        refresh=create_refresh_token(user.id, user.email),
    )


@router.get("/user/settings/", response_model=UserSettingsSchema)
def get_settings(user: CurrentUser) -> UserSettingsSchema:
    return UserSettingsSchema(
        preferences=user.preferences, has_claude_api_key=user.has_claude_api_key
    )


@router.put("/user/settings/", response_model=UserSettingsSchema)
def update_settings(
    payload: UserSettingsSchema, user: CurrentUser, session: SessionDep
) -> UserSettingsSchema:
    user.preferences = payload.preferences
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserSettingsSchema(
        preferences=user.preferences, has_claude_api_key=user.has_claude_api_key
    )


@router.put("/user/claude-api-key/", response_model=UserSettingsSchema)
def set_claude_api_key(
    payload: UpdateClaudeApiKeyRequest, user: CurrentUser, session: SessionDep
) -> UserSettingsSchema:
    # Encrypt before persisting — the plaintext key never reaches the database.
    user.claude_api = encrypt_secret(payload.claude_api_key.strip())
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserSettingsSchema(
        preferences=user.preferences, has_claude_api_key=user.has_claude_api_key
    )


@router.delete("/user/claude-api-key/", response_model=UserSettingsSchema)
def delete_claude_api_key(user: CurrentUser, session: SessionDep) -> UserSettingsSchema:
    user.claude_api = None
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserSettingsSchema(
        preferences=user.preferences, has_claude_api_key=user.has_claude_api_key
    )


@router.post("/user/update-email/", response_model=DetailResponse)
def update_email(
    payload: UpdateEmailRequest, user: CurrentUser, session: SessionDep
) -> DetailResponse:
    if not verify_password(payload.password, user.hashed_password):
        raise FieldValidationError({"password": ["Incorrect password."]})

    new_email = payload.email.lower()
    conflict = session.exec(select(User).where(User.email == new_email, User.id != user.id)).first()
    if conflict is not None:
        raise FieldValidationError({"email": ["This email is already in use."]})

    user.email = new_email
    session.add(user)
    session.commit()
    return DetailResponse(detail="Email updated.")


@router.post("/user/update-password/", response_model=DetailResponse)
def update_password(
    payload: UpdatePasswordRequest, user: CurrentUser, session: SessionDep
) -> DetailResponse:
    if not verify_password(payload.current_password, user.hashed_password):
        raise FieldValidationError({"current_password": ["Incorrect password."]})

    user.hashed_password = hash_password(payload.new_password)
    session.add(user)
    session.commit()
    return DetailResponse(detail="Password updated.")


@router.delete("/user/delete/", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: DeleteAccountRequest, user: CurrentUser, session: SessionDep
) -> Response:
    if not verify_password(payload.password, user.hashed_password):
        raise FieldValidationError({"password": ["Incorrect password."]})

    session.delete(user)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
