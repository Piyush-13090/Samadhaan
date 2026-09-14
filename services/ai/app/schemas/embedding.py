"""Request and response contracts for embedding generation.

snake_case on the wire, matching the rest of this service. The NestJS client
translates once; nothing downstream of it knows Python produced these.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EmbedTextRequest(BaseModel):
    """One or more texts to encode.

    A batch rather than a single string because encoding is dominated by model
    overhead, not by text length: ten texts in one call cost far less than ten
    calls. The API batches a problem's canonical text today and will batch a
    re-embedding backfill tomorrow.
    """

    texts: list[str] = Field(min_length=1, max_length=64)
    """The texts to encode. Bounded so one request cannot occupy the model
    indefinitely."""

    @property
    def cleaned(self) -> list[str]:
        """Texts with surrounding whitespace removed and empties dropped."""
        return [text.strip() for text in self.texts if text.strip()]


class EmbeddingVector(BaseModel):
    """One encoded text."""

    index: int
    """Position in the request, so a caller can align results without relying
    on list order surviving a future change."""

    embedding: list[float]


class EmbedTextResponse(BaseModel):
    """Encoded texts plus the provenance needed to use them safely."""

    embeddings: list[EmbeddingVector]

    provider: str
    model_name: str
    model_version: str
    dimensions: int
    """Width of every returned vector. The caller checks this against the
    database column before writing — a model swap that changes width must fail
    loudly, not write vectors that silently cannot be compared."""

    normalized: bool
    """True when vectors are unit length, which makes cosine similarity a dot
    product and lets pgvector's `<=>` operator be read directly as distance."""

    processing_ms: int


__all__ = [
    "EmbedTextRequest",
    "EmbedTextResponse",
    "EmbeddingVector",
]
