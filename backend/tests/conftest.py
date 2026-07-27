"""Shared fixtures.

The environment is configured at import time, before anything under ``app`` is
imported: ``app.config`` builds its ``Settings`` at module scope and raises when
``API_ENDPOINT`` is unset, and ``app.database`` builds its engine from
``DATABASE_URL`` the moment it is imported. Real environment variables take
precedence over the developer's ``backend/.env``, so a local ``.env`` cannot leak
into a test run.
"""

import os
import tempfile
from pathlib import Path

_TEST_STATE_DIR = Path(tempfile.mkdtemp(prefix="kifu-sensei-tests-"))

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "SECRET_KEY": "test-secret-key-not-a-real-credential",
        "ENCRYPTION_KEY": "test-encryption-key-not-a-real-credential",
        "ADMIN_USERNAME": "test-admin",
        "ADMIN_PASSWORD": "test-admin-password",
        # Never reached: every test that would call KataGo mocks the transport.
        "API_ENDPOINT": "http://katago.invalid",
        "API_TIMEOUT": "5",
        "DATABASE_URL": f"sqlite:///{_TEST_STATE_DIR / 'test.sqlite3'}",
        "FRONTEND_URL": "",
    }
)

import logging  # noqa: E402
from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, SQLModel  # noqa: E402

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402

TEST_PASSWORD = "correct-horse-battery"
TEST_EMAIL = "player@example.com"

# The commentary pipeline logs every generated prompt at INFO. That is useful when
# debugging a real run and pure noise in a test report, where it buries the failure
# under several screens of ASCII boards.
logging.getLogger("katago-service-logger").setLevel(logging.WARNING)


@pytest.fixture(scope="session")
def test_password() -> str:
    """The plaintext behind ``hashed_test_password``.

    Exposed as a fixture rather than imported from this module: ``tests`` has no
    ``__init__.py``, so importing it by path would load conftest a second time
    under a different module name.
    """
    return TEST_PASSWORD


@pytest.fixture(scope="session")
def hashed_test_password() -> str:
    """Hash the shared test password once.

    bcrypt is deliberately slow (~250 ms a call). Hashing per test would dominate
    the suite's runtime for no added coverage.
    """
    return hash_password(TEST_PASSWORD)


@pytest.fixture(autouse=True)
def _fresh_database() -> Iterator[None]:
    """Give every test an empty database."""
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    yield
    SQLModel.metadata.drop_all(engine)


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as db_session:
        yield db_session


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A client that does not run the app lifespan.

    ``_fresh_database`` already owns schema setup, so running ``init_db`` again per
    test would only add work and hide a broken fixture.
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def make_user(session: Session, hashed_test_password: str):
    """Factory inserting a user straight into the database."""

    def _make_user(
        email: str = TEST_EMAIL,
        *,
        claude_api: str | None = None,
        preferences: dict | None = None,
    ) -> User:
        user = User(
            email=email,
            hashed_password=hashed_test_password,
            claude_api=claude_api,
            **({"preferences": preferences} if preferences is not None else {}),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    return _make_user


@pytest.fixture
def user(make_user) -> User:
    return make_user()


@pytest.fixture
def auth_headers(user: User) -> dict[str, str]:
    """Bearer header for ``user``, minted directly rather than via ``/auth/token/``.

    Going through the login endpoint would add a bcrypt verify to every
    authenticated test; the token path itself is covered in ``test_auth_router``.
    """
    return {"Authorization": f"Bearer {create_access_token(user.id, user.email)}"}
