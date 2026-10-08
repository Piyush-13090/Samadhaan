"""AI-assisted priority features (Prompt 21).

Asks the provider for a constrained ``PriorityModelOutput`` and then
**validates it against the input** before returning anything:

* every evidence phrase must be traceable to the input text (most of its
  content words appear there) — otherwise it is dropped;
* a signal left with no evidence keeps its value but has its confidence
  halved: an unsupported judgement must not weigh much;
* a stated affected count is kept only if that number appears in the input —
  the model may extract a population figure, never estimate one.

The development provider runs no model; every signal is then returned as
null (unavailable) — nothing is invented, and NestJS scores without them.
"""

from __future__ import annotations

import re

from app.core.logging import get_logger
from app.prompts.priority_features import PROMPT_VERSION, SYSTEM_PROMPT, build_user_message
from app.providers.base import VisionLanguageProvider
from app.schemas.priority import (
    ModelSignal,
    PriorityFeatureRequest,
    PriorityFeatureResult,
    PriorityModelOutput,
    StatedCount,
)
from app.utils.timing import measure

logger = get_logger(__name__)

_WORD = re.compile(r"[a-z0-9]+")
_NUMBER = re.compile(r"\d[\d,]*")
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
    "was", "were", "be", "it", "this", "that", "with", "at", "by", "from", "near",
}  # fmt: skip


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


def source_text(request: PriorityFeatureRequest) -> str:
    return " ".join(
        [
            request.title,
            request.description,
            request.subcategory or "",
            request.analysis_summary or "",
            *request.observations,
        ]
    )


def grounded(phrase: str, vocabulary: set[str]) -> bool:
    """At least two-thirds of the phrase's content words occur in the input."""
    words = _words(phrase)
    if not words:
        return False
    return len(words & vocabulary) / len(words) >= 2 / 3


def unavailable() -> PriorityModelOutput:
    """Development provider: no model ran, so no signal is claimed."""
    empty = ModelSignal(value=None, confidence=0.0, evidence=[])
    return PriorityModelOutput(
        safety_risk=empty,
        urgency=empty,
        impact_breadth=empty,
        stated_affected=StatedCount(),
    )


def validate_features(
    output: PriorityModelOutput, request: PriorityFeatureRequest
) -> tuple[PriorityModelOutput, int]:
    vocabulary = _words(source_text(request))
    dropped = 0

    def clean(signal: ModelSignal) -> ModelSignal:
        nonlocal dropped
        evidence = [e.strip()[:160] for e in signal.evidence if e.strip()]
        kept = [e for e in evidence if grounded(e, vocabulary)]
        dropped += len(evidence) - len(kept)
        if signal.value is None:
            return ModelSignal(value=None, confidence=0.0, evidence=[])
        confidence = signal.confidence if kept else signal.confidence / 2
        return ModelSignal(value=signal.value, confidence=round(confidence, 4), evidence=kept)

    stated = output.stated_affected
    numbers = {int(n.replace(",", "")) for n in _NUMBER.findall(source_text(request))}
    if stated.value is not None and stated.value not in numbers:
        dropped += 1
        stated = StatedCount()
    elif stated.value is not None:
        stated = StatedCount(
            value=stated.value,
            unit=stated.unit,
            confidence=stated.confidence,
            evidence=[e for e in stated.evidence if grounded(e, vocabulary)],
        )

    return (
        PriorityModelOutput(
            safety_risk=clean(output.safety_risk),
            urgency=clean(output.urgency),
            impact_breadth=clean(output.impact_breadth),
            stated_affected=stated,
        ),
        dropped,
    )


class PriorityFeatureService:
    def __init__(self, provider: VisionLanguageProvider) -> None:
        self._provider = provider

    async def extract(self, request: PriorityFeatureRequest) -> PriorityFeatureResult:
        info = self._provider.info
        ai_ran = info.provider != "development"
        with measure() as elapsed:
            raw = await self._provider.generate(
                system_prompt=SYSTEM_PROMPT,
                user_message=build_user_message(request),
                output_type=PriorityModelOutput,
                development_fallback=unavailable,
                max_tokens=800,
            )
        clean, dropped = validate_features(raw, request)
        # Counts and values only — never the report text.
        logger.info(
            "priority_features",
            problem_id=request.problem_id,
            provider=info.provider,
            safety=clean.safety_risk.value,
            urgency=clean.urgency.value,
            impact=clean.impact_breadth.value,
            stated=clean.stated_affected.value is not None,
            dropped=dropped,
            ms=int(elapsed.milliseconds),
        )
        return PriorityFeatureResult(
            **clean.model_dump(),
            ai_ran=ai_ran,
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            prompt_version=PROMPT_VERSION,
            processing_ms=int(elapsed.milliseconds),
            dropped_evidence=dropped,
        )
