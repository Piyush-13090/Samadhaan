"""The embedding provider contract.

Separate from `VisionLanguageProvider` on purpose: encoding text into a vector
and reasoning about a photograph are different capabilities with different
models, different failure modes and different cost profiles. Forcing them
through one interface would mean every implementation stubbing out most of it.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.providers.base import ProviderError


@dataclass(frozen=True)
class EmbeddingProviderInfo:
    """Which model produced a vector, and how wide it is.

    Recorded on every stored embedding. Vectors from different models are not
    comparable — cosine similarity between them is a meaningless number that
    looks exactly like a meaningful one — so the model identity travels with
    the vector and the API refuses to compare across it.
    """

    provider: str
    model_name: str
    model_version: str
    dimensions: int
    normalized: bool


class EmbeddingProvider(ABC):
    """A model that turns content into vectors.

    `embed_texts` is the only method every provider must implement. Image and
    multimodal encoding are declared here so the shape of the eventual
    implementation is fixed, and default to raising `CAPABILITY_UNAVAILABLE` —
    an honest "this provider cannot do that", never a fabricated vector.
    """

    @property
    @abstractmethod
    def info(self) -> EmbeddingProviderInfo:
        """Identifies the model. Read after a call to record what ran."""

    @property
    def supports_images(self) -> bool:
        """Whether `embed_images` is implemented.

        Callers check this to decide whether the image signal is available,
        rather than calling and catching — the duplicate scorer needs to know
        *before* it builds a weight set.
        """
        return False

    @abstractmethod
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Encodes each text, returning one vector per input in order.

        Implementations must return vectors of exactly `info.dimensions` width,
        or raise `ProviderError`. A short vector reaching the database would be
        rejected by pgvector anyway, but far later and with a worse message.
        """

    async def embed_images(self, images: list[bytes]) -> list[list[float]]:
        """Encodes images. Not implemented by any current provider.

        Deliberately not stubbed with random or zero vectors: an image-similarity
        score computed from fabricated vectors is indistinguishable from a real
        one and would corrupt every duplicate decision it touched. The scorer
        renormalises its weights when this signal is absent, which is correct
        behaviour; a fake vector would defeat it.
        """
        raise ProviderError(
            "CAPABILITY_UNAVAILABLE",
            "This provider cannot embed images.",
            retryable=False,
        )


__all__ = ["EmbeddingProvider", "EmbeddingProviderInfo"]
