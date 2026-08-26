from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)


def _reject_passwords_too_long_for_bcrypt(password: str) -> str:
    """bcrypt (via pwdlib) raises ``ValueError`` on any input over 72 *bytes* — encoded
    as UTF-8, since a password with multi-byte characters can exceed that well under 72
    characters. Every field that reaches ``hash_password``/``verify_password`` needs
    this, or an over-length password turns into an unhandled 500 instead of a normal
    field error.
    """
    if len(password.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes long.")
    return password


_BcryptSafe = AfterValidator(_reject_passwords_too_long_for_bcrypt)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(min_length=8), _BcryptSafe]


class TokenObtainRequest(BaseModel):
    email: EmailStr
    password: Annotated[str, _BcryptSafe]


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


# Azure is deliberately absent: it needs deployment names, API versions, and a
# different auth header, so it gets its own adapter rather than pretending the
# OpenAI-compatible Bearer transport works for it.
ProviderName = Literal["claude", "openai-compatible"]


class AIProviderSettings(BaseModel):
    """Safe metadata about an account's AI provider configuration.

    Only names and booleans — never plaintext or ciphertext. ``has_api_key`` is
    whether a credential is stored; a local OpenAI-compatible server may be
    configured with no credential at all.
    """

    provider: ProviderName
    model: str
    base_url: str | None = None
    has_api_key: bool


class SaveAIProviderRequest(BaseModel):
    provider: ProviderName
    model: str = Field(min_length=1, max_length=200)
    #: Optional so a client can update model/base_url without resending a secret
    #: that the API never echoes back. An explicit empty string clears the
    #: credential (meaningful for local OpenAI-compatible servers).
    api_key: str | None = Field(default=None, max_length=4096)
    base_url: str | None = Field(default=None, max_length=2048)

    @field_validator("model")
    @classmethod
    def _strip_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Model must not be empty.")
        return value

    @field_validator("api_key")
    @classmethod
    def _strip_api_key(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("base_url")
    @classmethod
    def _normalize_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().rstrip("/")
        if not value:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("base_url must be an absolute http(s) URL.")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("base_url must not contain embedded credentials.")
        if parsed.query or parsed.fragment:
            raise ValueError("base_url must not contain a query string or fragment.")
        return value

    @model_validator(mode="after")
    def _check_provider_requirements(self) -> "SaveAIProviderRequest":
        if self.provider == "claude" and self.base_url is not None:
            # ClaudeProvider talks to Anthropic's endpoint; a stored base_url
            # nothing reads would be silently ignored config.
            raise ValueError("base_url is not supported for the claude provider.")
        return self


class UserSettingsSchema(BaseModel):
    preferences: dict
    has_claude_api_key: bool = False
    #: Provider-neutral metadata. ``None`` when the account has no AI provider
    #: configuration (and no legacy Claude key to fall back on).
    ai_provider: AIProviderSettings | None = None


class UpdateClaudeApiKeyRequest(BaseModel):
    claude_api_key: str = Field(min_length=1)


class UpdateEmailRequest(BaseModel):
    email: EmailStr
    password: Annotated[str, _BcryptSafe]


class UpdatePasswordRequest(BaseModel):
    current_password: Annotated[str, _BcryptSafe]
    new_password: Annotated[str, Field(min_length=8), _BcryptSafe]


class DeleteAccountRequest(BaseModel):
    password: Annotated[str, _BcryptSafe]


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
        "job_already_running",
        "job_abandoned",
        "provider_unsupported",
        "internal_error",
    ]
    retry_after: int | None = None
    #: The run already in progress, on ``job_already_running`` only. Without it a
    #: client can tell that *a* run is going but not which, so it cannot attach to
    #: it — and a retry earns the same 409.
    job_id: str | None = None


class GenerateCommentaryRequest(BaseModel):
    # A 19x19 SGF with commentary already attached is well under 1 MB; 2 MB leaves
    # generous room for a long game with verbose comments while still bounding the
    # worst case. (A request this large is also rejected before being buffered at
    # all — see MaxBodySizeMiddleware — this is the fallback for a client that
    # reports an honest but oversized Content-Length, or none.)
    sgf_content: str = Field(min_length=1, max_length=2_000_000)
    sgf_file_name: str = Field(min_length=5)
    # Any model ID: OpenAI, vLLM, and Ollama-compatible endpoints accept arbitrary
    # names (``gpt-4o``, ``qwen2.5-7b``, ``llama3.1``, …), so the per-run model is
    # no longer restricted to the Claude catalog.
    model: str = Field(default="claude-sonnet-5", min_length=1, max_length=200)
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
    """Token usage summed across the per-move commentary calls.

    The OpenAI-compatible transport normalizes its counters onto this shape
    (``prompt_tokens``/``completion_tokens`` → ``input_tokens``/``output_tokens``).
    The cache counters stay at zero today: the Anthropic pipeline sends no
    ``cache_control`` and the system prompt is far below the minimum cacheable
    prefix. They are reported so enabling prompt caching later needs no schema change.
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


class CommentaryHistoryItemSchema(BaseModel):
    """Summary shape for the history *list* — everything ``HistoryCard`` needs to
    render a row and its board thumbnail, but not the full comment text or the
    annotated SGF, which can each be tens of kilobytes and are only needed once a
    specific entry is opened (``GET /user/commentary-history/{id}/``).
    """

    id: int
    board_size: int
    sgf_file_name: str
    language: Literal["english", "chinese (simplified)", "japanese", "korean"]
    model: str | None = None
    created_at: datetime
    moves: list[list]
    initial_stones: list[list]
    comment_count: int


class UserCommentaryHistory(BaseModel):
    commentaries: list[CommentaryHistoryItemSchema]
    # Total rows the user has, independent of how many this page returned — the
    # client needs it to know whether a "Load more" makes sense.
    total: int


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
