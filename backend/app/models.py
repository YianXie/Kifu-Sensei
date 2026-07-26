from datetime import UTC, datetime

from sqlalchemy import JSON, Column, ForeignKey
from sqlmodel import Field, SQLModel

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
    claude_api: str | None = Field(default=None)
    preferences: dict = Field(
        default_factory=_default_preferences,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utcnow)

    @property
    def has_claude_api_key(self) -> bool:
        return bool(self.claude_api)


class Commentary(SQLModel, table=True):
    __tablename__ = "commentaries"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(ForeignKey("users.id"))
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
