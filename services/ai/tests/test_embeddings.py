"""Embedding provider abstraction, service and endpoint.

The real model is exercised in one opt-in test at the bottom. Everything else
runs against a fake provider: loading a transformer takes ten seconds and the
behaviour under test here is validation and error mapping, not the model.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider, EmbeddingProviderInfo
from app.providers.embedding_factory import (
    build_embedding_provider,
    reset_embedding_provider_cache,
)
from app.schemas.embedding import EmbedTextRequest
from app.services.embedding_service import EmbeddingService

DIMENSIONS = 384


def unit_vector(seed: float = 1.0, width: int = DIMENSIONS) -> list[float]:
    """A deterministic non-degenerate vector of the requested width."""
    raw = [seed + index for index in range(width)]
    norm = sum(value * value for value in raw) ** 0.5
    return [value / norm for value in raw]


class FakeEmbeddingProvider(EmbeddingProvider):
    """Returns prepared vectors, or raises. Stands in for a real encoder."""

    def __init__(
        self,
        vectors: list[list[float]] | None = None,
        error: Exception | None = None,
        *,
        dimensions: int = DIMENSIONS,
        supports_images: bool = False,
    ) -> None:
        self._vectors = vectors
        self._error = error
        self._dimensions = dimensions
        self._supports_images = supports_images
        self.calls: list[list[str]] = []

    @property
    def info(self) -> EmbeddingProviderInfo:
        return EmbeddingProviderInfo(
            provider="fake",
            model_name="fake-encoder",
            model_version="fake/1.0",
            dimensions=self._dimensions,
            normalized=True,
        )

    @property
    def supports_images(self) -> bool:
        return self._supports_images

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        if self._error is not None:
            raise self._error
        if self._vectors is not None:
            return self._vectors
        return [unit_vector(float(index + 1), self._dimensions) for index in range(len(texts))]


def settings(**overrides) -> Settings:
    payload = {
        "EMBEDDING_PROVIDER": "sentence-transformers",
        "EMBEDDING_MODEL": "sentence-transformers/all-MiniLM-L6-v2",
        "EMBEDDING_DIMENSIONS": DIMENSIONS,
    }
    payload.update(overrides)
    return Settings(**payload)


# =============================================================== the service


class TestEmbeddingService:
    async def test_returns_one_vector_per_text_with_provenance(self):
        service = EmbeddingService(FakeEmbeddingProvider())

        result = await service.embed_text(
            EmbedTextRequest(texts=["a pothole", "a streetlight"])
        )

        assert len(result.embeddings) == 2
        assert [vector.index for vector in result.embeddings] == [0, 1]
        assert all(len(v.embedding) == DIMENSIONS for v in result.embeddings)
        # Provenance travels with the vector. Without it, a later comparison
        # cannot tell whether two vectors came from the same model.
        assert result.model_name == "fake-encoder"
        assert result.model_version == "fake/1.0"
        assert result.dimensions == DIMENSIONS
        assert result.normalized is True

    async def test_strips_whitespace_and_drops_empty_texts(self):
        provider = FakeEmbeddingProvider()
        service = EmbeddingService(provider)

        await service.embed_text(EmbedTextRequest(texts=["  a pothole  ", "   ", "x"]))

        assert provider.calls == [["a pothole", "x"]]

    async def test_rejects_input_that_is_entirely_blank(self):
        service = EmbeddingService(FakeEmbeddingProvider())

        with pytest.raises(ProviderError) as caught:
            await service.embed_text(EmbedTextRequest(texts=["   ", ""]))

        assert caught.value.code == "INVALID_INPUT"
        assert caught.value.retryable is False

    async def test_rejects_a_vector_of_the_wrong_width(self):
        """A short vector must never reach the database.

        pgvector would reject it, but far later and against a column, not a
        model — by then the failure looks like a database problem.
        """
        provider = FakeEmbeddingProvider(vectors=[unit_vector(1.0, width=128)])
        service = EmbeddingService(provider)

        with pytest.raises(ProviderError) as caught:
            await service.embed_text(EmbedTextRequest(texts=["a pothole"]))

        assert caught.value.code == "DIMENSION_MISMATCH"
        assert caught.value.retryable is False

    async def test_rejects_a_mismatched_vector_count(self):
        """The worst failure mode available: every vector silently misaligned
        with its text, in a response that still looks well-formed."""
        provider = FakeEmbeddingProvider(vectors=[unit_vector()])
        service = EmbeddingService(provider)

        with pytest.raises(ProviderError) as caught:
            await service.embed_text(EmbedTextRequest(texts=["one", "two"]))

        assert caught.value.code == "PROVIDER_ERROR"

    async def test_propagates_a_provider_failure(self):
        provider = FakeEmbeddingProvider(
            error=ProviderError("PROVIDER_ERROR", "model died", retryable=True)
        )
        service = EmbeddingService(provider)

        with pytest.raises(ProviderError) as caught:
            await service.embed_text(EmbedTextRequest(texts=["a pothole"]))

        assert caught.value.retryable is True


# ============================================================== the contract


class TestEmbeddingProviderContract:
    async def test_image_embedding_is_refused_rather_than_faked(self):
        """The single most important guarantee in this module.

        A fabricated image vector produces a similarity score indistinguishable
        from a real one. The scorer renormalises around a missing signal; it
        cannot defend against a fake one.
        """
        provider = FakeEmbeddingProvider()

        assert provider.supports_images is False

        with pytest.raises(ProviderError) as caught:
            await provider.embed_images([b"\x89PNG"])

        assert caught.value.code == "CAPABILITY_UNAVAILABLE"
        assert caught.value.retryable is False


# =============================================================== the factory


class TestEmbeddingFactory:
    def setup_method(self):
        reset_embedding_provider_cache()

    def test_builds_the_sentence_transformer_provider(self):
        provider = build_embedding_provider(settings())

        assert provider.info.provider == "sentence-transformers"
        assert provider.info.dimensions == DIMENSIONS
        assert provider.info.normalized is True

    def test_reuses_one_provider_per_configuration(self):
        """Loading a model costs seconds and hundreds of megabytes."""
        first = build_embedding_provider(settings())
        second = build_embedding_provider(settings())

        assert first is second

    def test_refuses_an_unknown_provider(self):
        with pytest.raises(ProviderError) as caught:
            build_embedding_provider(settings(EMBEDDING_PROVIDER="magic"))

        assert caught.value.code == "PROVIDER_UNAVAILABLE"
        assert caught.value.retryable is False

    def test_refuses_an_unconfigured_provider(self):
        """There is deliberately no development stub for embeddings."""
        with pytest.raises(ProviderError):
            build_embedding_provider(settings(EMBEDDING_PROVIDER=""))

    def test_reports_configuration_state(self):
        assert settings().embeddings_configured is True
        assert settings(EMBEDDING_PROVIDER="").embeddings_configured is False
        assert settings(EMBEDDING_MODEL="").embeddings_configured is False


# ============================================================== the endpoint


class TestEmbeddingEndpoint:
    def test_requires_the_internal_token(self, monkeypatch):
        """Vectors are the substrate of duplicate detection. This endpoint is
        never reachable from anything but the NestJS API."""
        from app.core.config import get_settings

        get_settings.cache_clear()
        monkeypatch.setenv("AI_INTERNAL_TOKEN", "secret-token")

        with TestClient(__import__("app.main", fromlist=["app"]).app) as client:
            refused = client.post("/embeddings/text", json={"texts": ["a pothole"]})
            assert refused.status_code == 401

            wrong = client.post(
                "/embeddings/text",
                json={"texts": ["a pothole"]},
                headers={"x-internal-token": "not-it"},
            )
            assert wrong.status_code == 401

        get_settings.cache_clear()

    def test_rejects_an_empty_batch(self, client: TestClient):
        response = client.post("/embeddings/text", json={"texts": []})
        assert response.status_code == 422

    def test_rejects_an_oversized_batch(self, client: TestClient):
        response = client.post("/embeddings/text", json={"texts": ["x"] * 65})
        assert response.status_code == 422

    def test_rejects_a_malformed_body(self, client: TestClient):
        assert client.post("/embeddings/text", json={}).status_code == 422
        assert client.post("/embeddings/text", json={"texts": "a"}).status_code == 422


# ========================================================== the real model
#
# Opt-in: loading the encoder takes roughly ten seconds and downloads ~90 MB on
# a cold cache, which does not belong in every `npm run verify`. Run with:
#
#   SAMADHAAN_RUN_MODEL_TESTS=1 .venv/bin/pytest services/ai -k real_model
#
# This is the test that proves the pipeline encodes meaning rather than noise,
# so it is worth running whenever the model or its configuration changes.

REAL_MODEL = pytest.mark.skipif(
    os.environ.get("SAMADHAAN_RUN_MODEL_TESTS") != "1",
    reason="Set SAMADHAAN_RUN_MODEL_TESTS=1 to exercise the real encoder.",
)


@REAL_MODEL
class TestRealModel:
    async def test_real_model_separates_duplicates_from_unrelated_reports(self):
        service = EmbeddingService(build_embedding_provider(settings()))

        result = await service.embed_text(
            EmbedTextRequest(
                texts=[
                    "Large pothole near Sector 12 market",
                    "Road has a huge pothole outside Sector 12 market causing vehicles to swerve",
                    "Broken streetlight near Community Park has been out for two weeks",
                ]
            )
        )

        vectors = [entry.embedding for entry in result.embeddings]

        def cosine(a: list[float], b: list[float]) -> float:
            # Vectors are unit length, so the dot product is the cosine.
            return sum(x * y for x, y in zip(a, b, strict=True))

        duplicate_pair = cosine(vectors[0], vectors[1])
        unrelated_pair = cosine(vectors[0], vectors[2])

        assert result.dimensions == DIMENSIONS
        assert all(
            abs(sum(value * value for value in vector) ** 0.5 - 1.0) < 1e-5
            for vector in vectors
        )
        # The whole premise of semantic deduplication: two wordings of the same
        # problem must sit closer than two different problems.
        assert duplicate_pair > 0.6
        assert unrelated_pair < 0.4
        assert duplicate_pair > unrelated_pair + 0.3
