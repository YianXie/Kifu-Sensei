from datetime import UTC, datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

DEFAULT_USER_PREFERENCES: dict = {
    "theme": "system",
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
    preferences: dict = Field(
        default_factory=_default_preferences,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utcnow)
