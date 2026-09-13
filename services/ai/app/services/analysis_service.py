"""Orchestrates one problem analysis."""

from __future__ import annotations

from app.core.config import Settings
from app.core.logging import get_logger
from app.core.taxonomy import (
    clamp_confidence,
    normalise_category,
    normalise_severity,
    normalise_urgency,
)
from app.prompts.problem_analysis import SYSTEM_PROMPT, build_user_message
from app.providers.base import ProviderError, VisionLanguageProvider
from app.schemas.analysis import AnalysisResult, AnalyzeProblemRequest, ModelAnalysis
from app.utils.timing import measure

logger = get_logger(__name__)

# Midpoint of each severity band, on the 0–10 scale the triage queue orders by.
#
# Derived rather than asked for: a model can reliably place a problem in a band,
# but a specific number out of ten is not something it can calibrate, and asking
# for one produces false precision.
_SEVERITY_SCORE: dict[str, float] = {
    "LOW": 2.0,
    "MEDIUM": 5.0,
    "HIGH": 7.5,
    "CRITICAL": 9.5,
}


class AnalysisService:
    """Turns a report into a validated, taxonomy-normalised analysis.

    The provider is injected rather than constructed here, so the service is
    testable against a fake and swapping vendors never touches this file.
    """

    def __init__(self, provider: VisionLanguageProvider, settings: Settings) -> None:
        self._provider = provider
        self._settings = settings

    async def analyze(self, request: AnalyzeProblemRequest) -> AnalysisResult:
        user_message = build_user_message(
            title=request.title,
            description=request.description,
            category_hint=request.category_hint,
            subcategory_hint=request.subcategory_hint,
            locality=request.locality,
            image_count=len(request.images),
        )

        info = self._provider.info

        logger.info(
            "analysis_started",
            problem_id=request.problem_id,
            public_id=request.public_id,
            provider=info.provider,
            model=info.model_name,
            image_count=len(request.images),
        )

        with measure() as elapsed:
            raw = await self._provider.analyze(
                system_prompt=SYSTEM_PROMPT,
                user_message=user_message,
                images=request.images,
            )

        result = self._normalise(raw, request, info, int(elapsed.milliseconds))

        logger.info(
            "analysis_completed",
            problem_id=request.problem_id,
            provider=info.provider,
            category=result.category,
            severity=result.severity,
            urgency=result.urgency,
            confidence=result.confidence,
            processing_ms=result.processing_ms,
        )

        return result

    def _normalise(
        self,
        raw: ModelAnalysis,
        request: AnalyzeProblemRequest,
        info,
        processing_ms: int,
    ) -> AnalysisResult:
        """Maps model output onto the canonical taxonomy.

        Constrained decoding already restricts the model to the schema, so this
        rarely has work to do. It runs anyway: the schema is per-provider, and a
        future provider without constrained output would otherwise be able to
        write an unknown category straight into the database.
        """
        category = normalise_category(raw.category)
        severity = normalise_severity(raw.severity)
        urgency = normalise_urgency(raw.urgency)

        if category is None or severity is None or urgency is None:
            # Rejected rather than defaulted. A silently defaulted category is
            # indistinguishable from a real one downstream.
            raise ProviderError(
                "INVALID_MODEL_OUTPUT",
                "The AI model returned values outside the expected taxonomy.",
                retryable=True,
            )

        confidence = clamp_confidence(raw.confidence)
        if confidence is None:
            raise ProviderError(
                "INVALID_MODEL_OUTPUT",
                "The AI model did not return a usable confidence value.",
                retryable=True,
            )

        text_only = len(request.images) == 0

        # An analysis with no image saw half the evidence. Cap its confidence so
        # a text-only assessment cannot present itself as confidently as one
        # that actually looked at a photograph.
        if text_only:
            confidence = min(confidence, 0.75)

        subcategory = (raw.subcategory or "").strip() or None

        return AnalysisResult(
            problem_id=request.problem_id,
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            category=category,  # type: ignore[arg-type]
            subcategory=subcategory[:80] if subcategory else None,
            severity=severity,  # type: ignore[arg-type]
            urgency=urgency,  # type: ignore[arg-type]
            summary=raw.summary.strip(),
            confidence=round(confidence, 4),
            observations=[
                observation.strip()
                for observation in raw.observations
                if observation and observation.strip()
            ][:5],
            severity_score=_SEVERITY_SCORE[severity],
            processing_ms=processing_ms,
            image_count=len(request.images),
            text_only=text_only,
        )


__all__ = ["AnalysisService"]
