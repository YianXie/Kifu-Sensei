from collections.abc import Generator

from sqlalchemy import event, inspect, text
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")
# ``timeout`` (pysqlite's busy-wait, not a SQLAlchemy pool setting) is raised from its
# 5s default: several request handlers and the background job runner now write from
# separate connections against the same file, and the default window is easy to blow
# past under concurrent writes, surfacing as an unhandled "database is locked" 500.
connect_args = {"check_same_thread": False, "timeout": 30} if _is_sqlite else {}
# Explicit rather than SQLAlchemy's defaults (5 + 10): sized for the request
# threadpool plus ``commentary_pipeline_workers`` concurrent pipeline runs, now that
# nothing holds a connection for the run itself (see app.routers.go) — a connection is
# only ever checked out for a short query. ``pool_pre_ping`` avoids surfacing a stale
# connection (e.g. one a managed Postgres instance recycled while idle) as a request
# failure; irrelevant for a local SQLite file, so scoped to the non-SQLite branch.
pool_args = {} if _is_sqlite else {"pool_size": 10, "max_overflow": 20, "pool_pre_ping": True}
engine = create_engine(settings.database_url, connect_args=connect_args, **pool_args)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(dbapi_connection, _) -> None:
        cursor = dbapi_connection.cursor()
        # SQLite does not enforce foreign keys unless a connection turns it on for
        # itself — pysqlite gives no other hook, so this runs on every new
        # connection the pool opens.
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL lets readers and a writer proceed concurrently instead of the default
        # rollback journal's exclusive write lock — the natural pairing with the
        # raised busy timeout above, since with the default journal mode most
        # concurrent-write contention would still end in "database is locked" long
        # before 30s of waiting was of any use. A one-time, persistent change to the
        # database file, not a per-connection setting, but cheap to repeat.
        cursor.execute("PRAGMA journal_mode=WAL")
        # NORMAL is the standard pairing with WAL: still durable across an
        # application crash (what matters here), just not across an OS-level power
        # loss the way FULL is — an acceptable trade for a self-hosted SQLite file.
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


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
    if "token_version" not in existing:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0")
            )

    # Some deployments initialize with SQLModel.create_all rather than running the
    # Alembic chain. Keep those deployments compatible with the provider-neutral table
    # by copying the existing Claude ciphertext without ever decrypting it here.
    if "ai_provider_configs" in inspect(engine).get_table_names():
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO ai_provider_configs
                        (user_id, provider, encrypted_api_key, base_url, model,
                         created_at, updated_at)
                    SELECT id, 'claude', claude_api, NULL, 'claude-sonnet-5',
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    FROM users
                    WHERE claude_api IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM ai_provider_configs
                          WHERE ai_provider_configs.user_id = users.id
                      )
                    """
                )
            )


def init_db() -> None:
    # Import models so they are registered on SQLModel.metadata before create_all.
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _ensure_columns()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
