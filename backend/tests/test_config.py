"""Tests for settings loading and the production start-up guards.

Every test sets each variable it cares about explicitly rather than relying on the
values ``conftest`` installed, so a developer's ``backend/.env`` cannot change the
outcome.
"""

from collections.abc import Iterator

import pytest

from app.config import Settings, get_settings

DEV_SECRET = "dev-insecure-key-replace-in-production"
DEV_ENCRYPTION = "dev-insecure-encryption-key-replace-in-production"


@pytest.fixture
def isolated_settings_cache() -> Iterator[None]:
    """Let a test call ``get_settings`` freshly, then restore the cached instance."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    get_settings()


def _production_env(monkeypatch: pytest.MonkeyPatch, **overrides: str) -> None:
    values = {
        "ENVIRONMENT": "production",
        "SECRET_KEY": "a-real-production-secret",
        "ENCRYPTION_KEY": "a-real-production-encryption-key",
        "ADMIN_USERNAME": "real-admin",
        "ADMIN_PASSWORD": "real-admin-password",
        "API_ENDPOINT": "http://katago.invalid",
    }
    values.update(overrides)
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def test_is_production_only_for_the_production_environment() -> None:
    assert Settings(environment="production").is_production is True
    assert Settings(environment="development").is_production is False
    assert Settings(environment="test").is_production is False


def test_cors_origins_always_include_the_local_dev_server() -> None:
    origins = Settings(frontend_url=None).cors_origins
    assert set(origins) == {"http://localhost:5173", "http://127.0.0.1:5173"}


def test_cors_origins_include_the_configured_frontend_url() -> None:
    origins = Settings(frontend_url="https://kifu-sensei.example").cors_origins
    assert "https://kifu-sensei.example" in origins
    assert "http://localhost:5173" in origins


def test_cors_origins_are_deduplicated() -> None:
    origins = Settings(frontend_url="http://localhost:5173").cors_origins
    assert len(origins) == len(set(origins))
    assert len(origins) == 2


def test_unknown_environment_variables_are_ignored() -> None:
    """``extra="ignore"`` — an unrelated variable must not crash start-up."""
    assert Settings(some_unrelated_variable="x").environment is not None


@pytest.mark.usefixtures("isolated_settings_cache")
def test_production_rejects_the_default_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _production_env(monkeypatch, SECRET_KEY=DEV_SECRET)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        get_settings()


@pytest.mark.usefixtures("isolated_settings_cache")
def test_production_rejects_the_default_encryption_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _production_env(monkeypatch, ENCRYPTION_KEY=DEV_ENCRYPTION)
    with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
        get_settings()


@pytest.mark.usefixtures("isolated_settings_cache")
@pytest.mark.parametrize(
    ("variable", "value"),
    [("ADMIN_USERNAME", "dev-admin"), ("ADMIN_PASSWORD", "dev-admin-password")],
)
def test_production_rejects_default_admin_credentials(
    monkeypatch: pytest.MonkeyPatch, variable: str, value: str
) -> None:
    _production_env(monkeypatch, **{variable: value})
    with pytest.raises(RuntimeError, match="ADMIN_USERNAME"):
        get_settings()


@pytest.mark.usefixtures("isolated_settings_cache")
def test_api_endpoint_is_required_in_every_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("API_ENDPOINT", "")
    with pytest.raises(RuntimeError, match="API_ENDPOINT"):
        get_settings()


@pytest.mark.usefixtures("isolated_settings_cache")
def test_a_fully_configured_production_environment_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _production_env(monkeypatch)
    resolved = get_settings()
    assert resolved.is_production is True
    assert resolved.api_endpoint == "http://katago.invalid"


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
