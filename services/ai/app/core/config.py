"""Environment-driven configuration for the AI service.

Validated once at import time by pydantic-settings, so a misconfigured
deployment fails at startup rather than at the first request.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repository root, four levels up from this file
# (app/core/config.py -> app -> ai -> services -> repo root).
_REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    """All configuration the AI service reads."""

    model_config = SettingsConfigDict(
        # The shared root .env drives every service in development; a local
        # services/ai/.env overrides it for service-specific work.
        env_file=(_REPO_ROOT / ".env", Path(".env")),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = Field(default="development", alias="NODE_ENV")
    host: str = Field(default="0.0.0.0", alias="AI_HOST")
    port: int = Field(default=8000, alias="AI_PORT")
    log_level: str = Field(default="info", alias="AI_LOG_LEVEL")

    internal_token: str | None = Field(default=None, alias="AI_INTERNAL_TOKEN")
    """Shared secret. When set, requests must carry a matching
    `x-internal-token` header, so only the NestJS API can reach this service."""

    cors_origins_raw: str = Field(default="", alias="AI_CORS_ORIGINS")
    """Comma-separated origins. Empty in production: the browser must never
    call this service directly — it goes through the NestJS API."""

    # --- Vision-language model ---------------------------------------------
    llm_provider: str | None = Field(default=None, alias="LLM_PROVIDER")
    llm_api_key: str | None = Field(default=None, alias="LLM_API_KEY")
    llm_model: str | None = Field(default=None, alias="LLM_MODEL")
    llm_timeout_seconds: float = Field(default=60.0, alias="LLM_TIMEOUT_SECONDS")

    @property
    def default_llm_model(self) -> str:
        """Used when a provider is configured but no model is named."""
        return "claude-opus-5"

    # --- Reserved for later milestones -------------------------------------
    embedding_provider: str | None = Field(default=None, alias="EMBEDDING_PROVIDER")
    embedding_api_key: str | None = Field(default=None, alias="EMBEDDING_API_KEY")
    embedding_model: str | None = Field(default=None, alias="EMBEDDING_MODEL")
    embedding_dimensions: int = Field(default=1536, alias="EMBEDDING_DIMENSIONS")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]

    @property
    def llm_configured(self) -> bool:
        """Whether problem analysis can actually run.

        The development provider counts as configured — it needs no key — but
        only outside production, where the factory refuses to build it.
        """
        provider = (self.llm_provider or "").strip().lower()

        if provider == "development":
            return not self.is_production

        return bool(provider and self.llm_api_key)

    @property
    def embeddings_configured(self) -> bool:
        return bool(self.embedding_api_key and self.embedding_model)


@lru_cache
def get_settings() -> Settings:
    """Cached accessor. FastAPI dependencies and startup both use this."""
    return Settings()  # type: ignore[call-arg]
