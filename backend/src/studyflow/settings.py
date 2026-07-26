from enum import StrEnum
from typing import Annotated, Literal, Self
from urllib.parse import parse_qs, urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
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

    @field_validator("database_url")
    @classmethod
    def require_psycopg_postgresql_url(cls, value: SecretStr) -> SecretStr:
        parsed_url = urlsplit(value.get_secret_value())
        if parsed_url.scheme != "postgresql+psycopg":
            raise ValueError("Database URL must use postgresql+psycopg")
        if parsed_url.hostname is None or parsed_url.path in {"", "/"}:
            raise ValueError("Database URL must include a host and database name")
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
        return self
