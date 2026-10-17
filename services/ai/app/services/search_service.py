"""Search query understanding (Prompt 25).

Asks the provider for a constrained ``UnderstandModelOutput``. The schema
already limits every filter to an enum; this service additionally drops a
semantic query that is not grounded in the user's words, and a city that the
query does not contain.

The development provider runs no model: it returns confidence 0 and no
filters, and NestJS falls back to its rule-based reading.
"""

from __future__ import annotations

import re

from app.core.logging import get_logger
from app.prompts.search_understanding import PROMPT_VERSION, SYSTEM_PROMPT, build_user_message
from app.providers.base import VisionLanguageProvider
from app.schemas.search import (
    SearchFilters,
    UnderstandModelOutput,
    UnderstandRequest,
    UnderstandResult,
)

logger = get_logger(__name__)

_WORD = re.compile(r"[a-z0-9]+")


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if len(w) > 2}


def unavailable() -> UnderstandModelOutput:
    return UnderstandModelOutput(intent="SEARCH_ALL", confidence=0.0)


def validate_understanding(
    output: UnderstandModelOutput, request: UnderstandRequest
) -> UnderstandModelOutput:
    query_words = _words(request.query)
    filters = output.filters
    city = filters.city
    if city and not _words(city) <= query_words:
        city = None  # a place the user did not write
    semantic = output.semantic_query.strip()
    sem_words = _words(semantic)
    # Mostly the user's own words; a rewrite may add a little, not invent.
    if sem_words and len(sem_words & query_words) / len(sem_words) < 0.5:
        semantic = ""
    return UnderstandModelOutput(
        intent=output.intent,
        entity_type=output.entity_type,
        filters=SearchFilters(**{**filters.model_dump(), "city": city}),
        semantic_query=semantic[:200],
        confidence=output.confidence,
    )


class SearchUnderstandingService:
    def __init__(self, provider: VisionLanguageProvider) -> None:
        self._provider = provider

    async def understand(self, request: UnderstandRequest) -> UnderstandResult:
        info = self._provider.info
        raw = await self._provider.generate(
            system_prompt=SYSTEM_PROMPT,
            user_message=build_user_message(request),
            output_type=UnderstandModelOutput,
            development_fallback=unavailable,
            max_tokens=400,
        )
        clean = validate_understanding(raw, request)
        # Never the query text.
        logger.info(
            "search_understanding",
            provider=info.provider,
            intent=clean.intent,
            confidence=clean.confidence,
        )
        return UnderstandResult(
            **clean.model_dump(),
            ai_ran=info.provider != "development",
            provider=info.provider,
            model_name=info.model_name,
            prompt_version=PROMPT_VERSION,
        )
