"""Local sentence-transformers text encoder.

A real model running in this process — not a hosted API. That choice is
deliberate for a civic platform: embedding every report through a paid endpoint
makes deduplication cost scale with report volume, and the quality gap on short
descriptive text does not justify it. It also means duplicate detection works
offline and in CI without a key.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

import anyio

from app.core.logging import get_logger
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider, EmbeddingProviderInfo

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sentence_transformers import SentenceTransformer

logger = get_logger(__name__)

PROVIDER_NAME = "sentence-transformers"

# Loaded models, keyed by model id. Loading costs seconds and hundreds of MB, so
# it happens once per process rather than once per request. The lock stops two
# concurrent first requests each paying that cost.
_MODEL_CACHE: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()


def _load_model(model_id: str) -> SentenceTransformer:
    """Loads and caches a model. Blocking — never call from the event loop."""
    cached = _MODEL_CACHE.get(model_id)
    if cached is not None:
        return cached

    with _MODEL_LOCK:
        # Re-check inside the lock: another thread may have loaded it while
        # this one waited.
        cached = _MODEL_CACHE.get(model_id)
        if cached is not None:
            return cached

        # Imported lazily so the service starts — and the health endpoint
        # answers — without paying for torch when embeddings are not configured.
        from sentence_transformers import SentenceTransformer

        logger.info("embedding_model_loading", model=model_id)
        model = SentenceTransformer(model_id)
        _MODEL_CACHE[model_id] = model
        logger.info(
            "embedding_model_loaded",
            model=model_id,
            dimensions=_embedding_width(model),
        )
        return model


def _embedding_width(model: SentenceTransformer) -> int | None:
    """The model's own output width.

    `get_sentence_embedding_dimension` was renamed in sentence-transformers 6;
    both spellings are accepted so a version bump does not break logging.
    """
    for attribute in ("get_embedding_dimension", "get_sentence_embedding_dimension"):
        accessor = getattr(model, attribute, None)
        if callable(accessor):
            return accessor()
    return None


class SentenceTransformerProvider(EmbeddingProvider):
    """Encodes text with a locally-run sentence-transformers model.

    Vectors are L2-normalised, so cosine similarity is a plain dot product and
    pgvector's `<=>` (cosine distance) relates to similarity as `1 - distance`.
    Storing them any other way would push that normalisation into every query.
    """

    def __init__(self, *, model_id: str, expected_dimensions: int) -> None:
        self._model_id = model_id
        self._expected_dimensions = expected_dimensions
        self._library_version = self._read_library_version()

    @staticmethod
    def _read_library_version() -> str:
        try:
            from importlib.metadata import version

            return version("sentence-transformers")
        except Exception:  # noqa: BLE001 - provenance is best-effort
            return "unknown"

    @property
    def info(self) -> EmbeddingProviderInfo:
        return EmbeddingProviderInfo(
            provider=PROVIDER_NAME,
            model_name=self._model_id,
            # The library version, not a model revision: sentence-transformers
            # does not expose a stable revision for a cached model, and the
            # library version is what actually changes pooling behaviour.
            model_version=f"sentence-transformers/{self._library_version}",
            dimensions=self._expected_dimensions,
            normalized=True,
        )

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        try:
            # `encode` is CPU-bound and blocking. Running it on the event loop
            # would stall every other request in this process for its duration.
            vectors = await anyio.to_thread.run_sync(self._encode, texts)
        except ProviderError:
            raise
        except Exception as error:  # noqa: BLE001 - mapped to the shared shape
            logger.exception("embedding_failed", model=self._model_id)
            raise ProviderError(
                "PROVIDER_ERROR",
                "Text could not be encoded.",
                # A local model failing is usually memory or a corrupt cache;
                # neither is fixed by an immediate retry, but one more attempt
                # costs nothing here — there is no per-call charge.
                retryable=True,
            ) from error

        return vectors

    def _encode(self, texts: list[str]) -> list[list[float]]:
        """Blocking encode. Runs on a worker thread."""
        model = _load_model(self._model_id)

        encoded = model.encode(
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )

        width = int(encoded.shape[1])

        # The configured width and the model's actual width disagreeing means
        # the deployment is misconfigured. Failing here is far better than
        # writing vectors the database column will reject, or — worse — that it
        # accepts and that are then compared against an incompatible corpus.
        if width != self._expected_dimensions:
            raise ProviderError(
                "DIMENSION_MISMATCH",
                f"Model '{self._model_id}' produces {width}-dimensional vectors "
                f"but this deployment expects {self._expected_dimensions}.",
                retryable=False,
            )

        return [[float(value) for value in row] for row in encoded]


__all__ = ["PROVIDER_NAME", "SentenceTransformerProvider"]
