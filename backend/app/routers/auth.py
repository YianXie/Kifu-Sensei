import jwt
from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlmodel import delete, func, select

from app.crypto import encrypt_secret
from app.deps import CurrentUser, SessionDep
from app.errors import FieldValidationError
from app.models import Commentary, CommentaryJob, User
from app.schemas import (
    AccessTokenResponse,
    CommentaryHistoryItemSchema,
    DeleteAccountRequest,
    DetailResponse,
    GenerateCommentaryResponse,
    RegisterRequest,
    TokenObtainRequest,
    TokenPairResponse,
    TokenRefreshRequest,
    UpdateClaudeApiKeyRequest,
    UpdateEmailRequest,
    UpdatePasswordRequest,
    UserCommentaryHistory,
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
        access=create_access_token(user.id, user.email, user.token_version),
        refresh=create_refresh_token(user.id, user.email, user.token_version),
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
        token_version = claims["token_version"]
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise invalid from None

    user = session.get(User, user_id)
    # A version mismatch means this refresh token predates a password change or an
    # explicit logout — reject it exactly like an unknown user, rather than minting a
    # fresh pair from a token that was supposed to have been invalidated.
    if user is None or token_version != user.token_version:
        raise invalid

    return AccessTokenResponse(
        access=create_access_token(user.id, user.email, user.token_version),
        refresh=create_refresh_token(user.id, user.email, user.token_version),
    )


@router.post("/logout/", response_model=DetailResponse)
def logout(user: CurrentUser, session: SessionDep) -> DetailResponse:
    """Invalidate every access and refresh token issued to this account so far.

    Bumping ``token_version`` does this in one step rather than tracking individual
    tokens: every previously issued JWT — including the one authenticating this very
    request — now fails the version check in ``get_current_user``/``token_refresh``,
    while a freshly issued token (the next login) carries the new version and works.
    """
    user.token_version += 1
    session.add(user)
    session.commit()
    return DetailResponse(detail="Logged out.")


@router.get("/user/settings/", response_model=UserSettingsSchema)
def get_settings(user: CurrentUser) -> UserSettingsSchema:
    return UserSettingsSchema(
        preferences=user.preferences, has_claude_api_key=user.has_claude_api_key
    )


@router.put("/user/settings/", response_model=UserSettingsSchema)
def update_settings(
    payload: UserSettingsSchema, user: CurrentUser, session: SessionDep
) -> UserSettingsSchema:
    # Shallow-merge incoming preferences so that updating one section (e.g. the
    # theme in Miscellaneous) doesn't wipe out other sections (e.g. the default
    # commentary config saved from its own tab). Reassigning is required for the
    # JSON column to register as dirty.
    user.preferences = {**user.preferences, **payload.preferences}
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
    # Invalidate every token issued before this change — otherwise a stolen token
    # keeps working for the rest of its lifetime regardless of the password change
    # the victim just made in response to noticing the theft.
    user.token_version += 1
    session.add(user)
    session.commit()
    return DetailResponse(detail="Password updated.")


@router.delete("/user/delete/", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: DeleteAccountRequest, user: CurrentUser, session: SessionDep
) -> Response:
    if not verify_password(payload.password, user.hashed_password):
        raise FieldValidationError({"password": ["Incorrect password."]})

    # Both tables carry a foreign key to users.id (enforced on SQLite via the
    # connect-time PRAGMA in app.database, and by Postgres natively), so these
    # have to go before the user row or the delete below violates the constraint.
    # Deleting explicitly rather than relying on ON DELETE CASCADE also means a
    # deleted user's rows can never be handed to a future account that reuses the
    # same id.
    session.exec(delete(Commentary).where(Commentary.user_id == user.id))
    session.exec(delete(CommentaryJob).where(CommentaryJob.user_id == user.id))
    session.delete(user)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/user/commentary-history/", response_model=UserCommentaryHistory)
def get_commentary_history(
    user: CurrentUser,
    session: SessionDep,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
) -> UserCommentaryHistory:
    """List the user's saved reviews, newest first, as lightweight summaries.

    Each row's full comment text and annotated SGF can run to tens of kilobytes;
    returning every row a user has ever generated in one unbounded response does not
    scale with history size. ``GET /user/commentary-history/{id}/`` serves one row in
    full for when a specific entry is actually opened.
    """
    total = session.exec(
        select(func.count()).select_from(Commentary).where(Commentary.user_id == user.id)
    ).one()

    commentaries = session.exec(
        select(Commentary)
        .where(Commentary.user_id == user.id)
        .order_by(Commentary.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return UserCommentaryHistory(
        commentaries=[
            CommentaryHistoryItemSchema(
                id=commentary.id,
                board_size=commentary.board_size,
                sgf_file_name=commentary.sgf_file_name,
                language=commentary.language,
                model=commentary.model,
                created_at=commentary.created_at,
                moves=commentary.moves,
                initial_stones=commentary.initial_stones,
                comment_count=len(commentary.comments),
            )
            for commentary in commentaries
        ],
        total=total,
    )


@router.get("/user/commentary-history/{commentary_id}/", response_model=GenerateCommentaryResponse)
def get_commentary_detail(
    commentary_id: int, user: CurrentUser, session: SessionDep
) -> GenerateCommentaryResponse:
    """Fetch one saved review in full — the comment text and annotated SGF the list
    endpoint omits. Scoped to the caller: someone else's entry is reported missing,
    not forbidden, matching how commentary jobs are already treated."""
    commentary = session.exec(
        select(Commentary).where(Commentary.id == commentary_id, Commentary.user_id == user.id)
    ).first()
    if commentary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commentary not found.")

    return GenerateCommentaryResponse(
        board_size=commentary.board_size,
        sgf_file_name=commentary.sgf_file_name,
        language=commentary.language,
        model=commentary.model,
        usage=commentary.usage,
        moves=commentary.moves,
        initial_stones=commentary.initial_stones,
        comments=commentary.comments,
        annotated_sgf_content=commentary.annotated_sgf_content,
    )


@router.delete("/user/commentary-history/{commentary_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_commentary(commentary_id: int, user: CurrentUser, session: SessionDep) -> Response:
    """Permanently remove one saved review. Scoped to the caller the same way the
    detail endpoint is: someone else's entry is reported missing, not forbidden, so
    this cannot be used to probe which ids exist."""
    commentary = session.exec(
        select(Commentary).where(Commentary.id == commentary_id, Commentary.user_id == user.id)
    ).first()
    if commentary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commentary not found.")

    session.delete(commentary)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
