"""Analytics insights (Prompt 24).

Asks the provider for a constrained ``InsightModelOutput`` and then
**validates it against the facts** before returning anything:

* every statement must cite at least one known fact key — unknown keys are
  removed, and a statement left with none is dropped;
* every number in a statement must match a number in the facts (or the
  period label), allowing only ordinary rounding — otherwise it is dropped;
* a statement that states a cause ("because", "due to", …) is dropped;
* guidance notes must cite known guidance refs.

If the summary itself fails these checks it is replaced by a deterministic
one. The development provider runs no model: the result is then built from
the facts alone and marked ``ai_ran = False``.
"""

from __future__ import annotations

import re

from app.core.logging import get_logger
from app.prompts.analytics_insights import PROMPT_VERSION, SYSTEM_PROMPT, build_user_message
from app.providers.base import VisionLanguageProvider
from app.schemas.insights import (
    GuidanceNote,
    InsightModelOutput,
    InsightRequest,
    InsightResult,
    InsightStatement,
)
from app.utils.timing import measure

logger = get_logger(__name__)

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_CAUSAL = re.compile(
    r"\b(because|due to|caused by|causes?|causing|as a result of|resulting from|"
    r"driven by|owing to|leads? to|led to|thanks to|attributable to)\b",
    re.IGNORECASE,
)


def numbers_in(text: str) -> list[float]:
    values: list[float] = []
    for token in _NUMBER.findall(text):
        try:
            values.append(float(token.replace(",", "")))
        except ValueError:  # pragma: no cover - the pattern only matches numbers
            continue
    return values


def allowed_numbers(request: InsightRequest) -> set[float]:
    allowed: set[float] = set()
    for fact in request.facts:
        allowed.update(numbers_in(fact.value))
        allowed.update(numbers_in(fact.label))
    allowed.update(numbers_in(request.period_label))
    return allowed


def supported(number: float, allowed: set[float]) -> bool:
    """The number is a fact's number, or that number rounded."""
    for value in allowed:
        if number == value or round(value) == number or round(value, 1) == number:
            return True
    return False


def numbers_supported(text: str, allowed: set[float]) -> bool:
    return all(supported(n, allowed) for n in numbers_in(text))


def causal(text: str) -> bool:
    return _CAUSAL.search(text) is not None


def deterministic(request: InsightRequest) -> InsightModelOutput:
    """Built from the facts alone — used when no model runs, or as a fallback."""
    observations = [
        InsightStatement(text=f"{fact.label}: {fact.value}.", metric_keys=[fact.key])
        for fact in request.facts[:5]
    ]
    attention = [
        InsightStatement(text=f"{fact.label}: {fact.value}.", metric_keys=[fact.key])
        for fact in request.facts
        if fact.signal is not None
    ][:3]
    return InsightModelOutput(
        summary=(
            f"Observed figures for {request.period_label}. These are the recorded "
            "metrics, listed without interpretation."
        ),
        observations=observations,
        attention=attention,
        guidance_notes=[],
    )


def validate_insight(
    output: InsightModelOutput, request: InsightRequest
) -> tuple[InsightModelOutput, int]:
    keys = {fact.key for fact in request.facts}
    refs = {item.ref for item in request.guidance}
    allowed = allowed_numbers(request)
    dropped = 0

    def clean(items: list[InsightStatement]) -> list[InsightStatement]:
        nonlocal dropped
        kept: list[InsightStatement] = []
        for item in items:
            cited = [key for key in item.metric_keys if key in keys]
            text = item.text.strip()
            if not cited or not text or causal(text) or not numbers_supported(text, allowed):
                dropped += 1
                continue
            kept.append(InsightStatement(text=text, metric_keys=list(dict.fromkeys(cited))))
        return kept

    notes: list[GuidanceNote] = []
    for note in output.guidance_notes:
        cited = [ref for ref in note.refs if ref in refs]
        if not cited or causal(note.text) or not numbers_supported(note.text, allowed):
            dropped += 1
            continue
        notes.append(GuidanceNote(text=note.text.strip(), refs=list(dict.fromkeys(cited))))

    summary = output.summary.strip()
    if causal(summary) or not numbers_supported(summary, allowed):
        dropped += 1
        summary = deterministic(request).summary

    return (
        InsightModelOutput(
            summary=summary,
            observations=clean(output.observations),
            attention=clean(output.attention),
            guidance_notes=notes,
        ),
        dropped,
    )


class InsightService:
    def __init__(self, provider: VisionLanguageProvider) -> None:
        self._provider = provider

    async def summarise(self, request: InsightRequest) -> InsightResult:
        info = self._provider.info
        ai_ran = info.provider != "development"
        with measure() as elapsed:
            raw = await self._provider.generate(
                system_prompt=SYSTEM_PROMPT,
                user_message=build_user_message(request),
                output_type=InsightModelOutput,
                development_fallback=lambda: deterministic(request),
                max_tokens=1200,
            )
        clean, dropped = validate_insight(raw, request)
        # Counts only — never the facts or the text.
        logger.info(
            "analytics_insight",
            provider=info.provider,
            facts=len(request.facts),
            observations=len(clean.observations),
            attention=len(clean.attention),
            dropped=dropped,
            ms=int(elapsed.milliseconds),
        )
        return InsightResult(
            **clean.model_dump(),
            ai_ran=ai_ran,
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            prompt_version=PROMPT_VERSION,
            processing_ms=int(elapsed.milliseconds),
            dropped_statements=dropped,
        )
