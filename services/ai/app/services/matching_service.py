"""Organisation matching, orchestrated around an engine and an encoder."""

from __future__ import annotations

from collections import OrderedDict

from app.core.config import Settings
from app.core.logging import get_logger
from app.core.taxonomy import CATEGORY_GUIDANCE
from app.matching import features
from app.matching.engine import HeuristicMatchingEngine, MatchingEngine, TextSignals
from app.matching.ranking import rank
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider
from app.schemas.matching import (
    MatchModelInfo,
    MatchOrganizationsRequest,
    MatchOrganizationsResponse,
    OrganizationMatch,
)
from app.utils.timing import measure

logger = get_logger(__name__)

# Short phrases — expertise wording, type descriptions — recur across every
# request. Cached by (model, text) so each is encoded once per process.
_PHRASE_CACHE: OrderedDict[tuple[str, str], list[float]] = OrderedDict()
_PHRASE_CACHE_SIZE = 2048


def build_engine(settings: Settings) -> MatchingEngine:
    return HeuristicMatchingEngine(
        {
            "semantic": settings.matching_weight_semantic,
            "expertise": settings.matching_weight_expertise,
            "category": settings.matching_weight_category,
            "geographic": settings.matching_weight_geographic,
            "capability": settings.matching_weight_capability,
            "activity": settings.matching_weight_activity,
        }
    )


def expertise_phrase(category: str, subcategory: str | None) -> str:
    """How one declared area of work is put into words for the encoder."""
    guidance = CATEGORY_GUIDANCE.get(category, category.replace("_", " ").lower())
    return f"{subcategory}. {guidance}" if subcategory else guidance


class MatchingService:
    def __init__(self, engine: MatchingEngine, provider: EmbeddingProvider | None) -> None:
        self._engine = engine
        self._provider = provider

    async def match(self, request: MatchOrganizationsRequest) -> MatchOrganizationsResponse:
        with measure() as elapsed:
            degraded: list[str] = []
            text = await self._text_signals(request, degraded)
            if any(candidate.semantic_similarity is None for candidate in request.candidates):
                degraded.append("semantic:partial")

            scored = self._engine.score(request.problem, request.candidates, text)
            ranked = rank(
                scored,
                limit=request.options.result_limit,
                min_score=request.options.min_score,
            )

        matches = [
            OrganizationMatch(
                organization_id=entry.candidate.organization_id,
                rank=position + 1,
                final_score=entry.final_score,
                signals=entry.signals,
                reasons=entry.reasons,
                matched_expertise=entry.matched_expertise,
            )
            for position, entry in enumerate(ranked)
        ]

        model = MatchModelInfo(
            engine=self._engine.name,
            engine_version=self._engine.version,
            matching_version=self._engine.matching_version,
            weights=self._engine.weights,
            embedding_model=self._provider.info.model_name if self._provider else None,
            trained=self._engine.trained,
        )

        # Counts and timings only: no problem text, no organisation names.
        logger.info(
            "organization_matching_completed",
            public_id=request.problem.public_id,
            candidates=len(request.candidates),
            matched=len(matches),
            degraded=degraded,
            matching_version=model.matching_version,
            duration_ms=int(elapsed.milliseconds),
        )

        return MatchOrganizationsResponse(
            matches=matches,
            considered=len(request.candidates),
            degraded=degraded,
            model=model,
            processing_ms=int(elapsed.milliseconds),
        )

    async def _text_signals(
        self, request: MatchOrganizationsRequest, degraded: list[str]
    ) -> TextSignals:
        """Problem text against each expertise phrase and each type description.

        If the encoder is unavailable the match still runs on the taxonomy,
        semantic and geographic signals — degraded, and the response says so —
        rather than failing outright or inventing similarity.
        """
        if self._provider is None or not request.candidates:
            if self._provider is None:
                degraded.extend(["expertise:text", "capability"])
            return TextSignals()

        phrases = [
            expertise_phrase(entry.category, entry.subcategory)
            for candidate in request.candidates
            for entry in candidate.expertise
        ]
        types = [features.TYPE_DESCRIPTIONS[kind] for kind in features.TYPE_DESCRIPTIONS]

        try:
            problem_vector = (await self._provider.embed_texts([request.problem.focus_text]))[0]
            vectors = await self._phrases(phrases + types)
        except ProviderError as error:
            logger.warning("matching_text_signals_unavailable", code=error.code)
            degraded.extend(["expertise:text", "capability"])
            return TextSignals()

        def similarity(phrase: str) -> float:
            value = features.rescale(
                features.cosine(problem_vector, vectors[phrase]),
                features.PHRASE_FLOOR,
                features.PHRASE_CEILING,
            )
            return value if value is not None else 0.0

        expertise = [
            [
                similarity(expertise_phrase(entry.category, entry.subcategory))
                for entry in candidate.expertise
            ]
            for candidate in request.candidates
        ]
        capability = [
            similarity(features.TYPE_DESCRIPTIONS[candidate.type])
            for candidate in request.candidates
        ]
        return TextSignals(expertise=expertise, capability=capability)

    async def _phrases(self, phrases: list[str]) -> dict[str, list[float]]:
        assert self._provider is not None
        model = self._provider.info.model_name
        result: dict[str, list[float]] = {}
        missing: list[str] = []

        for phrase in dict.fromkeys(phrases):
            cached = _PHRASE_CACHE.get((model, phrase))
            if cached is None:
                missing.append(phrase)
            else:
                _PHRASE_CACHE.move_to_end((model, phrase))
                result[phrase] = cached

        for start in range(0, len(missing), 64):
            batch = missing[start : start + 64]
            for phrase, vector in zip(batch, await self._provider.embed_texts(batch), strict=True):
                result[phrase] = vector
                _PHRASE_CACHE[(model, phrase)] = vector
                if len(_PHRASE_CACHE) > _PHRASE_CACHE_SIZE:
                    _PHRASE_CACHE.popitem(last=False)

        return result


def reset_phrase_cache() -> None:
    _PHRASE_CACHE.clear()


__all__ = ["MatchingService", "build_engine", "expertise_phrase", "reset_phrase_cache"]
