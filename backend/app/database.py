from collections.abc import Generator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)


def _ensure_columns() -> None:
    """Add columns introduced after a table was first created.

    This is a minimal stand-in for a migration tool: it adds nullable columns to
    existing tables when they are missing so older databases keep working.
    """
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("users")}
    if "claude_api" not in existing:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE users ADD COLUMN claude_api VARCHAR"))


def init_db() -> None:
    # Import models so they are registered on SQLModel.metadata before create_all.
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
