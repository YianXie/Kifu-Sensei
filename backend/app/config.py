from datetime import timedelta
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    environment: str = "development"

    # Auth / JWT
    secret_key: str = "dev-insecure-key-replace-in-production"
    admin_username: str = "dev-admin"
    admin_password: str = "dev-admin-password"
    access_token_lifetime: timedelta = timedelta(minutes=30)
    refresh_token_lifetime: timedelta = timedelta(days=7)
    jwt_algorithm: str = "HS256"

    # Symmetric key (urlsafe base64, 32 bytes) used to encrypt secrets such as
    # users' Claude API keys at rest. Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    encryption_key: str = "dev-insecure-encryption-key-replace-in-production"

    # Database
    database_url: str = "sqlite:///./db.sqlite3"

    # CORS
    frontend_url: str | None = None

    # KataGo analysis engine
    api_endpoint: str | None = None
    api_timeout: int = 120

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origins(self) -> list[str]:
        origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
        if self.frontend_url:
            origins.append(self.frontend_url)
        return origins


@lru_cache
def get_settings() -> "Settings":
    settings = Settings()
    if settings.is_production and settings.secret_key.startswith("dev-insecure"):
        raise RuntimeError("SECRET_KEY environment variable is required in production")
    if settings.is_production and settings.encryption_key.startswith("dev-insecure"):
        raise RuntimeError("ENCRYPTION_KEY environment variable is required in production")
    if settings.is_production and (
        settings.admin_username == "dev-admin" or settings.admin_password == "dev-admin-password"
    ):
        raise RuntimeError("ADMIN_USERNAME and ADMIN_PASSWORD are required in production")
    if not settings.api_endpoint:
        raise RuntimeError("API_ENDPOINT must be set")
    return settings


settings = get_settings()
