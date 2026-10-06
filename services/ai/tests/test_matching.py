"""Organisation matching: features, engine, ranking, service and endpoint.

Deterministic throughout. The encoder is a bag-of-words fake — shared words
make texts similar — so the tests check matching behaviour, not a model. The
real encoder runs in one opt-in test at the bottom against the development
evaluation set.
"""

from __future__ import annotations

import hashlib
import math
import os

import pytest
from fastapi.testclient import TestClient

from app.api.routes.matching import get_matching_service
from app.core.config import Settings
from app.main import app
from app.matching import features
from app.matching.engine import HeuristicMatchingEngine, TextSignals
from app.matching.ranking import rank
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider, EmbeddingProviderInfo
from app.schemas.matching import (
    MatchCandidate,
    MatchExpertise,
    MatchOrganizationsRequest,
    MatchProblem,
)
from app.services.matching_service import MatchingService, build_engine, reset_phrase_cache

DIMENSIONS = 384


class BagOfWordsProvider(EmbeddingProvider):
    """Hashes words into a fixed-width vector. Deterministic and model-free."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    @property
    def info(self) -> EmbeddingProviderInfo:
        return EmbeddingProviderInfo("fake", "bag-of-words", "1", DIMENSIONS, True)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        self.calls += 1
        if self.fail:
            raise ProviderError("PROVIDER_UNAVAILABLE", "down", retryable=True)
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        vector = [0.0] * DIMENSIONS
        for word in "".join(c.lower() if c.isalnum() else " " for c in text).split():
            if len(word) > 3:
                vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIMENSIONS] += 1.0
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]


@pytest.fixture(autouse=True)
def _fresh_cache() -> None:
    reset_phrase_cache()


def engine() -> HeuristicMatchingEngine:
    return build_engine(Settings())  # type: ignore[return-value]


def pothole() -> MatchProblem:
    return MatchProblem(
        public_id="SAM-1023",
        category="POTHOLES",
        subcategory="Road surface cavity",
        severity="HIGH",
        focus_text="Large pothole on the road causing traffic disruption for two-wheelers",
    )


def candidate(org_id: str, **overrides: object) -> MatchCandidate:
    fields: dict[str, object] = {
        "organization_id": org_id,
        "type": "NGO",
        "expertise": [],
        "semantic_similarity": 0.3,
        "distance_meters": 5_000.0,
        "same_city": True,
        "has_location": True,
    }
    fields.update(overrides)
    return MatchCandidate(**fields)  # type: ignore[arg-type]


ROADSAFE = candidate(
    "roadsafe",
    expertise=[
        MatchExpertise(category="ROADS", subcategory="Road infrastructure", level="SPECIALIST")
    ],
    semantic_similarity=0.55,
)
MOBILITY = candidate(
    "mobility-lab",
    type="UNIVERSITY",
    expertise=[
        MatchExpertise(category="TRAFFIC", subcategory="Smart mobility", level="SPECIALIST")
    ],
    semantic_similarity=0.35,
)
CLEANCITY = candidate(
    "cleancity",
    expertise=[
        MatchExpertise(category="GARBAGE", subcategory="Waste management", level="SPECIALIST")
    ],
    semantic_similarity=0.12,
)

# ---------------------------------------------------------------------- features


def test_category_compatibility_uses_taxonomy_families() -> None:
    assert features.category_compatibility("POTHOLES", "POTHOLES") == 1.0
    assert features.category_compatibility("POTHOLES", "ROADS") == 0.6
    assert features.category_compatibility("POTHOLES", "GARBAGE") == 0.0
    assert features.category_compatibility("OTHER", "OTHER") == 1.0
    assert features.category_compatibility("OTHER", "ROADS") == 0.0


def test_ai_category_counts_as_a_discounted_second_opinion() -> None:
    # Reporter said OTHER, the AI said POTHOLES.
    assert features.problem_category_compatibility("OTHER", "POTHOLES", "POTHOLES") == 0.9
    assert features.problem_category_compatibility("POTHOLES", "OTHER", "POTHOLES") == 1.0


def test_rescale_clamps_to_the_informative_band() -> None:
    assert features.rescale(0.05, 0.1, 0.6) == 0.0
    assert features.rescale(0.35, 0.1, 0.6) == pytest.approx(0.5)
    assert features.rescale(0.9, 0.1, 0.6) == 1.0
    assert features.rescale(None, 0.1, 0.6) is None


def test_geography_decays_with_distance_and_never_punishes_the_unknown() -> None:
    near = features.geographic_relevance(1_000, True, True)
    far = features.geographic_relevance(500_000, False, True)
    assert near > 0.9
    assert far < 0.01
    assert features.geographic_relevance(None, True, False) == features.SAME_CITY_SCORE
    assert features.geographic_relevance(None, False, False) == features.UNKNOWN_LOCATION_SCORE


def test_activity_is_neutral_for_newcomers_and_saturates() -> None:
    assert features.activity_score(0) == 0.5
    assert features.activity_score(3) == 1.0
    assert features.activity_score(300) == 1.0


# ------------------------------------------------------------------------ engine


def test_engine_is_deterministic_and_ranks_the_road_organisation_first() -> None:
    scored_once = engine().score(pothole(), [ROADSAFE, MOBILITY, CLEANCITY], TextSignals())
    scored_again = engine().score(pothole(), [ROADSAFE, MOBILITY, CLEANCITY], TextSignals())
    assert [s.final_score for s in scored_once] == [s.final_score for s in scored_again]

    by_id = {s.candidate.organization_id: s.final_score for s in scored_once}
    assert by_id["roadsafe"] > by_id["mobility-lab"] > by_id["cleancity"]


def test_composite_is_the_weighted_average_of_available_signals() -> None:
    weights = {"semantic": 1.0, "expertise": 1.0}
    scored = HeuristicMatchingEngine(weights).score(pothole(), [ROADSAFE], TextSignals())[0]
    expected = (scored.signals.semantic + scored.signals.expertise) / 2  # type: ignore[operator]
    assert scored.final_score == pytest.approx(expected, abs=1e-4)


def test_a_missing_signal_is_redistributed_not_scored_zero() -> None:
    without = candidate("new", expertise=ROADSAFE.expertise, semantic_similarity=None)
    scored = engine().score(pothole(), [without], TextSignals())[0]
    assert scored.signals.semantic is None
    assert scored.signals.capability is None
    # Strong expertise with no embedding still scores as a real match.
    assert scored.final_score > 0.6


def test_a_new_organisation_is_not_penalised_for_having_no_history() -> None:
    veteran = candidate("veteran", expertise=ROADSAFE.expertise, relevant_activity_count=50)
    newcomer = candidate("newcomer", expertise=ROADSAFE.expertise, relevant_activity_count=0)
    scores = {
        s.candidate.organization_id: s.final_score
        for s in engine().score(pothole(), [veteran, newcomer], TextSignals())
    }
    # History moves the score by at most half of the activity weight's share —
    # here 0.05 of the 0.95 available, as capability needs the encoder.
    assert scores["veteran"] - scores["newcomer"] <= 0.5 * 0.05 / 0.95 + 1e-9


def test_geography_cannot_outrank_relevance() -> None:
    expert_far = candidate(
        "far", expertise=ROADSAFE.expertise, distance_meters=1_200_000.0, same_city=False
    )
    irrelevant_near = candidate(
        "near", expertise=CLEANCITY.expertise, semantic_similarity=0.12, distance_meters=0.0
    )
    scores = {
        s.candidate.organization_id: s.final_score
        for s in engine().score(pothole(), [expert_far, irrelevant_near], TextSignals())
    }
    assert scores["far"] > scores["near"]


def test_reasons_come_from_signals_that_fired() -> None:
    scored = engine().score(pothole(), [ROADSAFE, CLEANCITY], TextSignals())
    roadsafe, cleancity = scored
    codes = [reason.code for reason in roadsafe.reasons]
    assert "WITHIN_SERVICE_AREA" in codes
    assert "EXPERTISE_RELATED" in codes or "EXPERTISE_STRONG" in codes
    assert roadsafe.matched_expertise == [0]
    assert "EXPERTISE_STRONG" not in [r.code for r in cleancity.reasons]
    assert cleancity.matched_expertise == []


def test_matching_version_changes_with_the_weights() -> None:
    a = HeuristicMatchingEngine({"semantic": 0.35, "expertise": 0.3})
    b = HeuristicMatchingEngine({"semantic": 0.40, "expertise": 0.3})
    assert a.matching_version != b.matching_version
    assert a.matching_version.startswith("heuristic-baseline@1.0.0+")
    assert a.trained is False


def test_invalid_weights_are_refused() -> None:
    with pytest.raises(ValueError):
        HeuristicMatchingEngine({"popularity": 1.0})
    with pytest.raises(ValueError):
        HeuristicMatchingEngine({"semantic": -1.0})
    with pytest.raises(ValueError):
        HeuristicMatchingEngine({"semantic": 0.0})


# ----------------------------------------------------------------------- ranking


def test_ranking_drops_irrelevant_candidates_and_sorts_by_score() -> None:
    scored = engine().score(pothole(), [CLEANCITY, MOBILITY, ROADSAFE], TextSignals())
    ranked = rank(scored, limit=10, min_score=0.45)
    assert [r.candidate.organization_id for r in ranked][0] == "roadsafe"
    assert "cleancity" not in [r.candidate.organization_id for r in ranked]


def test_diversity_admits_a_relevant_unrepresented_type_only() -> None:
    ngos = [
        candidate(f"ngo-{i}", expertise=ROADSAFE.expertise, semantic_similarity=0.5)
        for i in range(3)
    ]
    university = candidate(
        "uni", type="UNIVERSITY", expertise=ROADSAFE.expertise, semantic_similarity=0.48
    )
    scored = engine().score(pothole(), [*ngos, university], TextSignals())
    ranked = rank(scored, limit=3, min_score=0.3)
    assert "uni" in [r.candidate.organization_id for r in ranked]
    assert [r.final_score for r in ranked] == sorted((r.final_score for r in ranked), reverse=True)

    # An irrelevant organisation of a new type is never forced in.
    industry = candidate(
        "ind", type="INDUSTRY", expertise=CLEANCITY.expertise, semantic_similarity=0.1
    )
    scored = engine().score(pothole(), [*ngos, industry], TextSignals())
    assert "ind" not in [r.candidate.organization_id for r in rank(scored, limit=3, min_score=0.3)]


# ----------------------------------------------------------------------- service


async def test_service_uses_expertise_wording_and_type_fit() -> None:
    provider = BagOfWordsProvider()
    service = MatchingService(engine(), provider)
    request = MatchOrganizationsRequest(
        problem=pothole(), candidates=[ROADSAFE, MOBILITY, CLEANCITY]
    )
    response = await service.match(request)

    assert [m.organization_id for m in response.matches][0] == "roadsafe"
    assert response.degraded == []
    assert response.model.embedding_model == "bag-of-words"
    assert response.model.trained is False
    assert all(m.signals.capability is not None for m in response.matches)

    # Phrases are cached: a second identical request encodes only the problem.
    calls = provider.calls
    await service.match(request)
    assert provider.calls == calls + 1


async def test_service_degrades_when_the_encoder_fails() -> None:
    service = MatchingService(engine(), BagOfWordsProvider(fail=True))
    response = await service.match(
        MatchOrganizationsRequest(problem=pothole(), candidates=[ROADSAFE, CLEANCITY])
    )
    assert "capability" in response.degraded
    assert response.matches[0].organization_id == "roadsafe"
    assert response.matches[0].signals.capability is None


async def test_service_with_no_candidates_returns_nothing() -> None:
    response = await MatchingService(engine(), BagOfWordsProvider()).match(
        MatchOrganizationsRequest(problem=pothole(), candidates=[])
    )
    assert response.matches == []
    assert response.considered == 0


# ---------------------------------------------------------------------- endpoint


@pytest.fixture
def client() -> TestClient:
    app.dependency_overrides[get_matching_service] = lambda: MatchingService(
        engine(), BagOfWordsProvider()
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def body(**overrides: object) -> dict:
    payload: dict = {
        "problem": {
            "public_id": "SAM-1023",
            "category": "POTHOLES",
            "focus_text": "Pothole on the main road",
        },
        "candidates": [
            {
                "organization_id": "roadsafe",
                "type": "NGO",
                "expertise": [{"category": "ROADS", "subcategory": None, "level": "SPECIALIST"}],
                "semantic_similarity": 0.5,
                "distance_meters": 1000,
                "same_city": True,
                "has_location": True,
            },
            {
                "organization_id": "unembedded",
                "type": "INDUSTRY",
                "expertise": [
                    {"category": "POTHOLES", "subcategory": None, "level": "EXPERIENCED"}
                ],
            },
        ],
        "options": {"result_limit": 5, "min_score": 0.0},
    }
    payload.update(overrides)
    return payload


def test_endpoint_returns_ranked_matches_with_version_metadata(client: TestClient) -> None:
    response = client.post("/match/organizations", json=body())
    assert response.status_code == 200
    data = response.json()
    assert [m["rank"] for m in data["matches"]] == [1, 2]
    assert set(data["matches"][0]["signals"]) == {
        "semantic",
        "expertise",
        "category",
        "geographic",
        "capability",
        "activity",
    }
    assert data["model"]["engine"] == "heuristic-baseline"
    assert data["model"]["matching_version"].startswith("heuristic-baseline@1.0.0+")
    assert data["model"]["weights"]["semantic"] == 0.35
    # One candidate had no embedding; the response says so.
    assert "semantic:partial" in data["degraded"]
    unembedded = next(m for m in data["matches"] if m["organization_id"] == "unembedded")
    assert unembedded["signals"]["semantic"] is None


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["problem"].update(category="ROADWORKS"),
        lambda b: b["problem"].update(focus_text=""),
        lambda b: b["candidates"][0].update(type="GOVERNMENT"),
        lambda b: b["candidates"][0].update(semantic_similarity=1.5),
        lambda b: b["candidates"][0]["expertise"][0].update(level="GURU"),
        lambda b: b["options"].update(result_limit=500),
    ],
)
def test_endpoint_rejects_invalid_input(client: TestClient, mutate) -> None:
    payload = body()
    mutate(payload)
    assert client.post("/match/organizations", json=payload).status_code == 422


def test_endpoint_accepts_an_empty_candidate_list(client: TestClient) -> None:
    response = client.post("/match/organizations", json=body(candidates=[]))
    assert response.status_code == 200
    assert response.json()["matches"] == []


def test_endpoint_requires_the_internal_token_when_configured(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setenv("AI_INTERNAL_TOKEN", "secret")
    config.get_settings.cache_clear()
    try:
        with TestClient(app) as unauthenticated:
            assert unauthenticated.post("/match/organizations", json=body()).status_code == 401
    finally:
        monkeypatch.delenv("AI_INTERNAL_TOKEN")
        config.get_settings.cache_clear()


# ------------------------------------------------------ development evaluation


async def test_development_set_ranks_sensibly_with_a_model_free_encoder() -> None:
    from evaluation.organization_matching import evaluate

    results = {r.problem_id: r for r in await evaluate(BagOfWordsProvider())}
    pothole_ranking = [org for org, _ in results["pothole"].ranking]
    # The prompt's own example: road NGO high, mobility lab medium, waste NGO low.
    assert pothole_ranking.index("roadsafe") < pothole_ranking.index("mobility-lab")
    assert pothole_ranking.index("mobility-lab") < pothole_ranking.index("cleancity")
    assert sum(r.precision_at_1 for r in results.values()) / len(results) >= 0.8


REAL_MODEL = pytest.mark.skipif(
    os.environ.get("SAMADHAAN_RUN_MODEL_TESTS") != "1",
    reason="Set SAMADHAAN_RUN_MODEL_TESTS=1 to exercise the real encoder.",
)


@REAL_MODEL
async def test_real_model_development_set() -> None:
    from app.core.config import get_settings
    from app.providers.embedding_factory import build_embedding_provider
    from evaluation.organization_matching import evaluate

    results = await evaluate(build_embedding_provider(get_settings()))
    assert sum(r.precision_at_1 for r in results) / len(results) == 1.0
    assert sum(r.ndcg_at_3 for r in results) / len(results) >= 0.9
