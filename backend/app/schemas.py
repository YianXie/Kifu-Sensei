from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class TokenObtainRequest(BaseModel):
    email: EmailStr
    password: str


class TokenRefreshRequest(BaseModel):
    refresh: str


class UserPublic(BaseModel):
    id: int
    email: str
    preferences: dict
    has_claude_api_key: bool = False

    # ``from_attributes`` lets this be built straight from a ``User`` ORM instance.
    # It was previously spelled ``form_attributes`` inside a class-based ``Config``,
    # so it silently did nothing and emitted a Pydantic V2 deprecation warning.
    model_config = ConfigDict(from_attributes=True)


class TokenPairResponse(BaseModel):
    access: str
    refresh: str
    user: UserPublic


class AccessTokenResponse(BaseModel):
    access: str
    refresh: str


class UserSettingsSchema(BaseModel):
    preferences: dict
    has_claude_api_key: bool = False


class UpdateClaudeApiKeyRequest(BaseModel):
    claude_api_key: str = Field(min_length=1)


class UpdateEmailRequest(BaseModel):
    email: EmailStr
    password: str


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class DeleteAccountRequest(BaseModel):
    password: str


class DetailResponse(BaseModel):
    detail: str


class CommentaryErrorResponse(BaseModel):
    """Error body for ``POST /api/commentary/``.

    ``code`` is the stable, machine-readable discriminator — clients branch on it
    rather than on ``detail``, which is prose and may be reworded.
    """

    detail: str
    code: Literal[
        "no_api_key",
        "invalid_sgf",
        "upstream_rate_limited",
        "upstream_auth_failed",
        "upstream_error",
        "katago_unavailable",
        "internal_error",
    ]
    retry_after: int | None = None


class GenerateCommentaryRequest(BaseModel):
    sgf_content: str = Field(min_length=1)
    sgf_file_name: str = Field(min_length=5)
    model: Literal["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"] = (
        "claude-sonnet-5"
    )
    language: Literal["english", "chinese (simplified)", "japanese", "korean"] = "english"
    num_comments: int = Field(default=20, ge=1, le=100)
    max_token: int = Field(default=1024, ge=256, le=8192)
    custom_instruction: str = Field(default="", max_length=1000)


class CommentaryItemSchema(BaseModel):
    turn: int
    comment: str
    # Win-rate change in percentage points from the perspective of the player who made
    # the move; negative means the move lost win rate. Clients map this to a severity
    # tier (blunder / mistake / notable) — thresholds are a display concern and are
    # deliberately not fixed here, so they can be tuned without a schema change.
    #
    # Both fields are always populated on a freshly generated commentary. They are
    # optional because ``/auth/user/commentary-history/`` replays rows saved before
    # these fields existed through this same schema; making them required 500s that
    # endpoint for every pre-existing row. ``None`` rather than ``0.0`` so a missing
    # value can't be mistaken for a genuinely neutral move. Clients can still recover
    # ``color`` from ``moves[turn - 1][0]``, which old rows do have.
    winrate_delta: float | None = None
    color: Literal["B", "W"] | None = None


class CommentaryUsageSchema(BaseModel):
    """Anthropic token usage summed across the per-move commentary calls.

    The cache counters stay at zero today: the pipeline sends no ``cache_control`` and
    the system prompt is far below the minimum cacheable prefix. They are reported so
    enabling prompt caching later needs no schema change.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


class GenerateCommentaryResponse(BaseModel):
    board_size: int
    sgf_file_name: str
    language: Literal["english", "chinese (simplified)", "japanese", "korean"]
    # Optional for the same reason as CommentaryItemSchema's added fields: the history
    # endpoint replays rows saved before these columns existed through this schema.
    model: str | None = None
    usage: CommentaryUsageSchema | None = None
    moves: list[list]
    initial_stones: list[list]
    comments: list[CommentaryItemSchema]
    annotated_sgf_content: str


class UserCommentaryHistory(BaseModel):
    commentaries: list[GenerateCommentaryResponse]


CommentaryJobStatus = Literal["queued", "running", "succeeded", "failed"]


class CommentaryJobCreatedResponse(BaseModel):
    job_id: str
    status: CommentaryJobStatus


class CommentaryJobProgress(BaseModel):
    """Comments written so far, out of the number actually selected for this game.

    ``total`` is 0 until the KataGo passes finish and the move set is known — it is the
    count of moves picked, which is ``min(num_comments, moves available)`` and so can be
    lower than the requested ``num_comments`` on a short game.
    """

    done: int = 0
    total: int = 0


class CommentaryJobStatusResponse(BaseModel):
    job_id: str
    status: CommentaryJobStatus
    progress: CommentaryJobProgress
    result: GenerateCommentaryResponse | None = None
    error: CommentaryErrorResponse | None = None
