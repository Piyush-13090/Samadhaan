"""Builds the configured embedding provider."""

from __future__ import annotations

from app.core.config import Settings
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider
from app.providers.sentence_transformer_provider import (
    PROVIDER_NAME as SENTENCE_TRANSFORMERS,
)
from app.providers.sentence_transformer_provider import SentenceTransformerProvider

# Cached per configuration, because constructing a provider is cheap but the
# model it lazily loads is not — a fresh provider per request would still hit
# the module-level model cache, but keeping one instance makes that explicit.
_PROVIDER_CACHE: dict[tuple[str, str, int], EmbeddingProvider] = {}


def build_embedding_provider(settings: Settings) -> EmbeddingProvider:
    """Returns the provider named by `EMBEDDING_PROVIDER`.

    Raises `ProviderError` rather than falling back to anything. There is no
    development stub for embeddings and there must not be one: a fabricated
    vector produces a similarity score that is indistinguishable from a real
    one, and duplicate decisions made on it would be untraceable nonsense.
    """
    provider = (settings.embedding_provider or "").strip().lower()

    if provider != SENTENCE_TRANSFORMERS:
        raise ProviderError(
            "PROVIDER_UNAVAILABLE",
            f"Unsupported EMBEDDING_PROVIDER '{settings.embedding_provider}'. "
            f"Supported: {SENTENCE_TRANSFORMERS}.",
            retryable=False,
        )

    model_id = settings.embedding_model or settings.default_embedding_model
    key = (provider, model_id, settings.embedding_dimensions)

    cached = _PROVIDER_CACHE.get(key)
    if cached is not None:
        return cached

    built = SentenceTransformerProvider(
        model_id=model_id,
        expected_dimensions=settings.embedding_dimensions,
    )
    _PROVIDER_CACHE[key] = built
    return built


def reset_embedding_provider_cache() -> None:
    """Clears the cache. Tests use this; nothing in the request path does."""
    _PROVIDER_CACHE.clear()


__all__ = ["build_embedding_provider", "reset_embedding_provider_cache"]
