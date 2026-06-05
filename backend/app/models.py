from datetime import UTC, datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

DEFAULT_USER_PREFERENCES: dict = {
    "theme": "system",
    "commentary_config": {
        "model": "claude-haiku-4-5",
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
    # Fernet-encrypted Claude API key. Only the ciphertext is ever stored; the
    # plaintext key cannot be recovered without the application's ENCRYPTION_KEY.
    claude_api: str | None = Field(default=None)
    preferences: dict = Field(
        default_factory=_default_preferences,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utcnow)

    @property
    def has_claude_api_key(self) -> bool:
        return bool(self.claude_api)
