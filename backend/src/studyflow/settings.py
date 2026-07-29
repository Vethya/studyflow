from enum import StrEnum
from typing import Annotated, Literal, Self
from urllib.parse import parse_qs, urlsplit

from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


DEFAULT_DATABASE_URL = "postgresql+psycopg://studyflow:studyflow@localhost:5432/studyflow"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="STUDYFLOW_",
        extra="ignore",
        frozen=True,
    )

    environment: Environment = Environment.DEVELOPMENT
    debug: bool = False
    log_level: Literal["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] = "INFO"
    database_url: SecretStr = SecretStr(DEFAULT_DATABASE_URL)
    database_readiness_timeout_seconds: Annotated[float, Field(gt=0, le=10)] = 2.0
    password_breach_timeout_seconds: Annotated[float, Field(gt=0, le=30)] = 5.0
    smtp_host: str = "localhost"
    smtp_port: Annotated[int, Field(ge=1, le=65_535)] = 1025
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_start_tls: bool = False
    email_from_address: EmailStr = "no-reply@example.com"
    public_app_url: str = "http://localhost:5173"

    @field_validator("database_url")
    @classmethod
    def require_psycopg_postgresql_url(cls, value: SecretStr) -> SecretStr:
        parsed_url = urlsplit(value.get_secret_value())
        if parsed_url.scheme != "postgresql+psycopg":
            raise ValueError("Database URL must use postgresql+psycopg")
        if parsed_url.hostname is None or parsed_url.path in {"", "/"}:
            raise ValueError("Database URL must include a host and database name")
        return value

    @field_validator("public_app_url")
    @classmethod
    def require_http_public_app_url(cls, value: str) -> str:
        parsed_url = urlsplit(value)
        if parsed_url.scheme not in {"http", "https"} or parsed_url.hostname is None:
            raise ValueError("Public app URL must use HTTP or HTTPS and include a host")
        return value.rstrip("/")

    @field_validator("smtp_username", mode="before")
    @classmethod
    def normalize_blank_smtp_username(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("smtp_password", mode="before")
    @classmethod
    def normalize_blank_smtp_password(cls, value: object) -> object:
        if value == "" or (isinstance(value, SecretStr) and value.get_secret_value() == ""):
            return None
        return value

    @model_validator(mode="after")
    def reject_debug_in_production(self) -> Self:
        if self.environment is Environment.PRODUCTION and self.debug:
            raise ValueError("Debug mode must be disabled in production")
        if self.environment is Environment.PRODUCTION:
            database_url = self.database_url.get_secret_value()
            if database_url == DEFAULT_DATABASE_URL:
                raise ValueError("Production requires an explicit database URL")

            ssl_modes = parse_qs(urlsplit(database_url).query).get("sslmode", [])
            if len(ssl_modes) != 1 or ssl_modes[0] not in {
                "require",
                "verify-ca",
                "verify-full",
            }:
                raise ValueError("Production database URL must require TLS")
            if urlsplit(self.public_app_url).scheme != "https":
                raise ValueError("Production public app URL must use HTTPS")
            if not self.smtp_start_tls:
                raise ValueError("Production SMTP delivery must use TLS")
        return self
