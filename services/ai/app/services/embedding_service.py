"""Embedding generation, orchestrated around a provider."""

from __future__ import annotations

from app.core.logging import get_logger
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider
from app.schemas.embedding import EmbeddingVector, EmbedTextRequest, EmbedTextResponse
from app.utils.timing import measure

logger = get_logger(__name__)


class EmbeddingService:
    """Turns texts into stored-vector-shaped responses.

    Thin by design. The provider owns encoding; this owns validation of the
    result and the provenance the caller must record alongside it.
    """

    def __init__(self, provider: EmbeddingProvider) -> None:
        self._provider = provider

    async def embed_text(self, request: EmbedTextRequest) -> EmbedTextResponse:
        texts = request.cleaned

        if not texts:
            raise ProviderError(
                "INVALID_INPUT",
                "No non-empty text was provided to encode.",
                retryable=False,
            )

        info = self._provider.info

        with measure() as elapsed:
            vectors = await self._provider.embed_texts(texts)

        # A provider returning the wrong count would silently misalign every
        # vector with its text — the worst possible failure here, because the
        # result still looks well-formed.
        if len(vectors) != len(texts):
            raise ProviderError(
                "PROVIDER_ERROR",
                "The encoder returned a different number of vectors than texts.",
                retryable=True,
            )

        for vector in vectors:
            if len(vector) != info.dimensions:
                raise ProviderError(
                    "DIMENSION_MISMATCH",
                    f"The encoder returned a {len(vector)}-dimensional vector "
                    f"where {info.dimensions} was expected.",
                    retryable=False,
                )

        logger.info(
            "embeddings_generated",
            provider=info.provider,
            model=info.model_name,
            count=len(vectors),
            dimensions=info.dimensions,
            duration_ms=int(elapsed.milliseconds),
        )

        return EmbedTextResponse(
            embeddings=[
                EmbeddingVector(index=index, embedding=vector)
                for index, vector in enumerate(vectors)
            ],
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            dimensions=info.dimensions,
            normalized=info.normalized,
            processing_ms=int(elapsed.milliseconds),
        )


__all__ = ["EmbeddingService"]
