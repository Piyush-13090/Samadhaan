"""Analysis service, provider abstraction and endpoint."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.providers.base import ProviderError, ProviderInfo, VisionLanguageProvider
from app.providers.development_provider import DevelopmentProvider
from app.providers.factory import build_provider
from app.schemas.analysis import AnalysisImage, AnalyzeProblemRequest, ModelAnalysis
from app.services.analysis_service import AnalysisService

# A 1×1 PNG. Valid base64, so schema tests exercise the real path.
TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def make_request(**overrides) -> AnalyzeProblemRequest:
    payload = {
        "problem_id": "prb-1",
        "title": "Huge pothole outside the market",
        "description": "A large pothole outside Sector 12 market is causing accidents.",
        "images": [],
    }
    payload.update(overrides)
    return AnalyzeProblemRequest(**payload)


class FakeProvider(VisionLanguageProvider):
    """Returns whatever it is given, or raises. Stands in for a real model."""

    def __init__(self, result: ModelAnalysis | None = None, error: Exception | None = None):
        self._result = result
        self._error = error
        self.calls: list[dict] = []

    @property
    def info(self) -> ProviderInfo:
        return ProviderInfo(provider="fake", model_name="fake-model", model_version="1")

    async def analyze(self, *, system_prompt, user_message, images) -> ModelAnalysis:
        self.calls.append(
            {"system": system_prompt, "user": user_message, "images": images}
        )
        if self._error:
            raise self._error
        assert self._result is not None
        return self._result


def valid_analysis(**overrides) -> ModelAnalysis:
    payload = {
        "category": "POTHOLES",
        "subcategory": "road surface cavity",
        "severity": "HIGH",
        "urgency": "HIGH",
        "summary": "A large pothole on a busy road is causing vehicles to swerve.",
        "confidence": 0.94,
        "observations": ["Visible road surface damage.", "Description mentions accidents."],
    }
    payload.update(overrides)
    return ModelAnalysis(**payload)


def settings() -> Settings:
    return Settings(NODE_ENV="development", LLM_PROVIDER="development")


# ---------------------------------------------------------------- the service


class TestAnalysisService:
    async def test_returns_a_normalised_result(self) -> None:
        service = AnalysisService(FakeProvider(valid_analysis()), settings())

        result = await service.analyze(make_request())

        assert result.category == "POTHOLES"
        assert result.severity == "HIGH"
        assert result.confidence == 0.75  # text-only cap, see below
        assert result.severity_score == 7.5
        assert result.model_name == "fake-model"

    async def test_sends_both_the_image_and_the_text(self) -> None:
        """The whole point of a multimodal system: both reach the model."""
        provider = FakeProvider(valid_analysis())
        service = AnalysisService(provider, settings())

        request = make_request(
            images=[AnalysisImage(media_type="image/png", data=TINY_PNG)]
        )
        await service.analyze(request)

        call = provider.calls[0]
        assert len(call["images"]) == 1
        assert "Huge pothole outside the market" in call["user"]
        assert "causing accidents" in call["user"]

    async def test_passes_the_citizen_hint_as_a_hint(self) -> None:
        provider = FakeProvider(valid_analysis())
        service = AnalysisService(provider, settings())

        await service.analyze(make_request(category_hint="ROADS"))

        user_message = provider.calls[0]["user"]
        assert "ROADS" in user_message
        # Explicitly non-binding, so the model does not ratify a wrong guess.
        assert "hint only" in user_message.lower()

    # A text-only analysis saw half the evidence and must not present itself
    # as confidently as one that looked at a photograph.
    async def test_caps_confidence_when_no_image_was_sent(self) -> None:
        service = AnalysisService(FakeProvider(valid_analysis(confidence=0.99)), settings())

        result = await service.analyze(make_request(images=[]))

        assert result.text_only is True
        assert result.confidence == 0.75

    async def test_keeps_high_confidence_when_an_image_was_analysed(self) -> None:
        service = AnalysisService(FakeProvider(valid_analysis(confidence=0.94)), settings())

        result = await service.analyze(
            make_request(images=[AnalysisImage(media_type="image/png", data=TINY_PNG)])
        )

        assert result.text_only is False
        assert result.confidence == 0.94

    async def test_derives_severity_score_from_the_band(self) -> None:
        for severity, expected in [
            ("LOW", 2.0), ("MEDIUM", 5.0), ("HIGH", 7.5), ("CRITICAL", 9.5),
        ]:
            service = AnalysisService(
                FakeProvider(valid_analysis(severity=severity)), settings()
            )
            result = await service.analyze(make_request())
            assert result.severity_score == expected

    async def test_records_which_model_produced_the_result(self) -> None:
        service = AnalysisService(FakeProvider(valid_analysis()), settings())

        result = await service.analyze(make_request())

        assert result.provider == "fake"
        assert result.model_version == "1"

    async def test_propagates_a_provider_failure(self) -> None:
        service = AnalysisService(
            FakeProvider(error=ProviderError("TIMEOUT", "too slow", retryable=True)),
            settings(),
        )

        with pytest.raises(ProviderError) as raised:
            await service.analyze(make_request())

        assert raised.value.retryable is True


# --------------------------------------------------------------- the provider


class TestDevelopmentProvider:
    async def test_is_deterministic(self) -> None:
        provider = DevelopmentProvider()

        first = await provider.analyze(
            system_prompt="", user_message="a huge pothole in the road", images=[]
        )
        second = await provider.analyze(
            system_prompt="", user_message="a huge pothole in the road", images=[]
        )

        assert first == second

    async def test_classifies_by_keyword(self) -> None:
        provider = DevelopmentProvider()

        result = await provider.analyze(
            system_prompt="", user_message="the streetlight is not working", images=[]
        )

        assert result.category == "STREETLIGHTS"

    # It must be identifiable as a stub wherever its output ends up.
    async def test_labels_itself_as_not_ai(self) -> None:
        provider = DevelopmentProvider()

        result = await provider.analyze(system_prompt="", user_message="garbage", images=[])

        assert "not by an AI model" in result.summary
        assert provider.info.provider == "development"
        assert "development" in provider.info.model_name
        # Low enough that the UI says "AI is less certain about this".
        assert result.confidence <= 0.5


class TestProviderFactory:
    def test_builds_the_development_provider_outside_production(self) -> None:
        provider = build_provider(
            Settings(NODE_ENV="development", LLM_PROVIDER="development")
        )

        assert isinstance(provider, DevelopmentProvider)

    # The guard that keeps a keyword stub away from real civic reports.
    def test_refuses_the_development_provider_in_production(self) -> None:
        with pytest.raises(ProviderError) as raised:
            build_provider(Settings(NODE_ENV="production", LLM_PROVIDER="development"))

        assert raised.value.code == "PROVIDER_UNAVAILABLE"
        assert raised.value.retryable is False

    # Never a silent fallback: a fabricated severity is worse than none.
    def test_refuses_anthropic_without_a_key_rather_than_falling_back(self) -> None:
        with pytest.raises(ProviderError) as raised:
            build_provider(
                Settings(NODE_ENV="development", LLM_PROVIDER="anthropic", LLM_API_KEY=None)
            )

        assert raised.value.code == "PROVIDER_UNAVAILABLE"

    def test_rejects_an_unknown_provider(self) -> None:
        with pytest.raises(ProviderError):
            build_provider(Settings(NODE_ENV="development", LLM_PROVIDER="made-up"))


# --------------------------------------------------------------- the endpoint


class TestAnalysisEndpoint:
    def test_analyses_a_report(self, client: TestClient) -> None:
        response = client.post(
            "/analyze/problem",
            json={
                "problem_id": "prb-1",
                "title": "Huge pothole outside the market",
                "description": "A large pothole outside the market is causing accidents.",
                "images": [],
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["category"] == "POTHOLES"
        assert body["provider"] == "development"

    def test_rejects_a_malformed_request(self, client: TestClient) -> None:
        response = client.post("/analyze/problem", json={"problem_id": "x"})

        assert response.status_code == 422
        assert response.json()["code"] == "VALIDATION_FAILED"

    def test_rejects_a_description_that_is_too_long(self, client: TestClient) -> None:
        response = client.post(
            "/analyze/problem",
            json={
                "problem_id": "prb-1",
                "title": "A title",
                "description": "x" * 5000,
                "images": [],
            },
        )

        assert response.status_code == 422

    def test_rejects_more_images_than_allowed(self, client: TestClient) -> None:
        response = client.post(
            "/analyze/problem",
            json={
                "problem_id": "prb-1",
                "title": "A title here",
                "description": "A description long enough to pass validation.",
                "images": [
                    {"media_type": "image/png", "data": TINY_PNG} for _ in range(9)
                ],
            },
        )

        assert response.status_code == 422

    # SVG is excluded at the schema level, not only at upload.
    def test_rejects_an_unsupported_media_type(self, client: TestClient) -> None:
        response = client.post(
            "/analyze/problem",
            json={
                "problem_id": "prb-1",
                "title": "A title here",
                "description": "A description long enough to pass validation.",
                "images": [{"media_type": "image/svg+xml", "data": TINY_PNG}],
            },
        )

        assert response.status_code == 422
