"""Builds the configured vision-language provider."""

from __future__ import annotations

from app.core.config import Settings
from app.core.logging import get_logger
from app.providers.anthropic_provider import AnthropicVisionProvider
from app.providers.base import ProviderError, VisionLanguageProvider
from app.providers.development_provider import DevelopmentProvider

logger = get_logger(__name__)

_clients: dict[tuple[str, str, float, float], AnthropicVisionProvider] = {}


async def close_providers() -> None:
    """Closes cached provider clients (application shutdown)."""
    clients = list(_clients.values())
    _clients.clear()
    for client in clients:
        await client.aclose()


def build_provider(settings: Settings) -> VisionLanguageProvider:
    """Returns the provider named by `LLM_PROVIDER`.

    Raises `ProviderError` rather than falling back. A missing key must surface
    as "analysis unavailable", never as a fabricated result — a made-up severity
    attached to a real civic problem is indistinguishable from a real one and
    would quietly corrupt the triage queue.
    """
    provider = (settings.llm_provider or "").strip().lower()

    if provider == "development":
        # Two independent conditions, so one misconfigured variable is not
        # enough to put the stub in front of real users.
        if settings.is_production:
            raise ProviderError(
                "PROVIDER_UNAVAILABLE",
                "The development provider cannot run in production.",
                retryable=False,
            )

        logger.warning(
            "development_provider_selected",
            detail="Keyword matching, not AI. Development only.",
        )
        return DevelopmentProvider()

    if provider == "anthropic":
        if not settings.llm_api_key:
            raise ProviderError(
                "PROVIDER_UNAVAILABLE",
                "AI analysis is not configured on this server.",
                retryable=False,
            )

        # One client per configuration, reused (Prompt 29). Building an
        # `AsyncAnthropic` per request opened a fresh connection pool every
        # time and never closed it.
        key = (
            settings.llm_api_key,
            settings.llm_model or settings.default_llm_model,
            settings.llm_timeout_seconds,
            settings.llm_deadline_seconds,
        )
        cached = _clients.get(key)
        if cached is None:
            cached = AnthropicVisionProvider(
                api_key=settings.llm_api_key,
                model=settings.llm_model or settings.default_llm_model,
                timeout_seconds=settings.llm_timeout_seconds,
                deadline_seconds=settings.llm_deadline_seconds,
            )
            _clients[key] = cached
        return cached

    raise ProviderError(
        "PROVIDER_UNAVAILABLE",
        f"Unsupported LLM_PROVIDER '{settings.llm_provider}'. Supported: anthropic, development.",
        retryable=False,
    )


__all__ = ["build_provider"]
