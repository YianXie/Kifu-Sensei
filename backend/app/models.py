from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import JSON, Column, Index, text
from sqlmodel import Field, SQLModel

# How long a finished job row is kept before the next job created by that user prunes
# it. The result is duplicated into the permanent Commentary row, so this only bounds
# how long a client has to collect it by job id.
COMMENTARY_JOB_RETENTION = timedelta(hours=24)

DEFAULT_USER_PREFERENCES: dict = {
    "theme": "system",
    "commentary_config": {
        "model": "claude-sonnet-5",
        "language": "english",
        "num_comments": 20,
        "max_token": 1024,
        "custom_instruction": "",
    },
}


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _default_preferences() -> dict:
    return dict(DEFAULT_USER_PREFERENCES)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    # Legacy Claude credential (Fernet ciphertext), mirrored from AIProviderConfig by
    # the Claude save paths and read as a fallback by the commentary pipeline and the
    # settings APIs. Kept until a cleanup migration drops it.
    claude_api: str | None = Field(default=None)
    # Stamped into every JWT this user is issued and checked on every use (see
    # deps.get_current_user, security.decode_token's callers). Bumping it — on
    # password change or explicit logout — invalidates every token minted before the
    # bump in one step, without keeping a denylist of individual tokens.
    token_version: int = Field(default=0)
    preferences: dict = Field(
        default_factory=_default_preferences,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utcnow)

    @property
    def has_claude_api_key(self) -> bool:
        return bool(self.claude_api)


class AIProviderConfig(SQLModel, table=True):
    """The provider-neutral AI configuration for one account.

    ``encrypted_api_key`` contains Fernet ciphertext only. The legacy
    ``User.claude_api`` column remains in place as a fallback for accounts that
    predate this table and as the mirror the Claude save paths keep in sync; it will
    be dropped by a later cleanup migration once every deployment has run the
    backfill (see ``database._ensure_columns`` and the Alembic migration chain).
    """

    __tablename__ = "ai_provider_configs"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", unique=True, index=True)
    provider: str = Field(default="claude")
    encrypted_api_key: str | None = Field(default=None)
    base_url: str | None = Field(default=None)
    model: str = Field(default="claude-sonnet-5")
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @property
    def has_api_key(self) -> bool:
        return bool(self.encrypted_api_key)


class Commentary(SQLModel, table=True):
    __tablename__ = "commentaries"

    id: int | None = Field(default=None, primary_key=True)
    # Indexed for the ownership filter on every history read.
    user_id: int = Field(foreign_key="users.id", index=True)
    board_size: int = Field(default=19)
    sgf_file_name: str = Field(default="")
    language: str = Field(default="english")
    # Nullable: rows saved before these columns existed keep NULL rather than a
    # fabricated model name or a zeroed token count that would read as real data.
    model: str | None = Field(default=None)
    usage: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    moves: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    initial_stones: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    comments: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    annotated_sgf_content: str = Field(default="")
    created_at: datetime = Field(default_factory=_utcnow)


class CommentaryJob(SQLModel, table=True):
    """An in-flight or finished commentary run, polled by ``GET .../jobs/{id}/``.

    Exists because a Manifest V3 extension service worker is terminated when a single
    ``fetch()`` takes more than 30 seconds, so the browser cannot hold the multi-minute
    synchronous request open. Splitting it into a submit plus short polls also gives
    honest per-move progress instead of a spinner.

    ``result`` duplicates what is written to :class:`Commentary` rather than pointing at
    it, so a job stays collectable even if the history write fails.
    """

    __tablename__ = "commentary_jobs"
    __table_args__ = (
        # At most one queued/running job per user, enforced by the database rather
        # than a check-then-insert in the router — two near-simultaneous requests
        # would both pass a plain SELECT and both start a pipeline run otherwise.
        # Finished jobs (succeeded/failed) are unrestricted, since they no longer
        # occupy the pipeline executor.
        Index(
            "ix_commentary_jobs_one_active_per_user",
            "user_id",
            unique=True,
            sqlite_where=text("status IN ('queued', 'running')"),
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    # Indexed for the ownership check on every poll and for retention pruning.
    user_id: int = Field(foreign_key="users.id", index=True)
    status: str = Field(default="queued", index=True)
    progress_done: int = Field(default=0)
    progress_total: int = Field(default=0)
    result: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    error_code: str | None = Field(default=None)
    error_detail: str | None = Field(default=None)
    retry_after: int | None = Field(default=None)
    created_at: datetime = Field(default_factory=_utcnow, index=True)
    updated_at: datetime = Field(default_factory=_utcnow)
