"""AI-assisted evidence verification (Prompt 22).

Builds the prompt from NestJS's bounded context (extracting text from any
documents here), asks the provider — with the before and after photos — for a
constrained ``VerificationModelOutput``, then **validates it against the
request** before returning anything:

* observations must cite refs that exist (F#, B#, G#) — otherwise dropped;
* a signal whose inputs are absent is nulled (no before/after pair → no visual
  consistency; no readable document → no documentation score);
* with no evidence photo and no readable document, the recommendation is
  INSUFFICIENT_EVIDENCE whatever the model said.

The development provider runs no model: every signal is null and no
recommendation is claimed (``ai_ran: false``).
"""

from __future__ import annotations

import base64
import binascii

from app.core.logging import get_logger
from app.knowledge.extraction import extract
from app.prompts.evidence_verification import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    build_user_message,
)
from app.providers.base import ProviderError, VisionLanguageProvider
from app.schemas.verification import (
    Observation,
    Signal,
    VerificationModelOutput,
    VerifyEvidenceRequest,
    VerifyEvidenceResult,
)
from app.utils.timing import measure

logger = get_logger(__name__)

MAX_DOCUMENT_CHARS = 6000
_NULL = Signal(value=None, confidence=0.0)


def read_documents(request: VerifyEvidenceRequest) -> dict[str, str]:
    """Text of each document, bounded. Unreadable documents are skipped."""
    texts: dict[str, str] = {}
    for document in request.documents:
        try:
            data = base64.b64decode(document.file_base64, validate=True)
            text = extract(data, None, max_pages=50).text.strip()
        except (binascii.Error, ValueError, ProviderError):
            continue
        if text:
            texts[document.ref] = text[:MAX_DOCUMENT_CHARS]
    return texts


def unavailable() -> VerificationModelOutput:
    """Development provider: no model ran, so nothing is claimed."""
    return VerificationModelOutput(
        relevance=_NULL,
        visual_consistency=_NULL,
        completion_signals=_NULL,
        documentation=_NULL,
        recommendation="INSUFFICIENT_EVIDENCE",
        confidence=0.0,
    )


def validate_verification(
    output: VerificationModelOutput,
    request: VerifyEvidenceRequest,
    documents: dict[str, str],
) -> tuple[VerificationModelOutput, int]:
    known = (
        {f.ref for f in request.files}
        | {i.ref for i in request.before_images}
        | {g.ref for g in request.guidance}
    )
    dropped = 0

    def cite(items: list[Observation]) -> list[Observation]:
        nonlocal dropped
        kept = []
        for item in items:
            refs = [r for r in dict.fromkeys(item.refs) if r in known]
            text = item.text.strip()
            if not refs or not text:
                dropped += 1
                continue
            kept.append(Observation(text=text[:240], refs=refs))
        return kept

    def signal(s: Signal, possible: bool = True) -> Signal:
        if not possible or s.value is None:
            return _NULL
        return s

    has_after = bool(request.after_images)
    has_pair = has_after and bool(request.before_images)
    recommendation = output.recommendation
    if not has_after and not documents:
        recommendation = "INSUFFICIENT_EVIDENCE"
    return (
        VerificationModelOutput(
            relevance=signal(output.relevance),
            visual_consistency=signal(output.visual_consistency, has_pair),
            completion_signals=signal(output.completion_signals),
            documentation=signal(output.documentation, bool(documents)),
            recommendation=recommendation,
            confidence=output.confidence,
            supporting=cite(output.supporting),
            remaining_issues=cite(output.remaining_issues),
        ),
        dropped,
    )


class VerificationService:
    def __init__(self, provider: VisionLanguageProvider) -> None:
        self._provider = provider

    async def verify(self, request: VerifyEvidenceRequest) -> VerifyEvidenceResult:
        info = self._provider.info
        ai_ran = info.provider != "development"
        documents = read_documents(request)
        images = [i.image for i in request.before_images] + [i.image for i in request.after_images]
        # Tell the model which image is which, in the order they are attached.
        order = ", ".join(i.ref for i in [*request.before_images, *request.after_images])
        message = build_user_message(request, documents)
        if order:
            message = f"Images attached, in order: {order}.\n\n{message}"
        with measure() as elapsed:
            raw = await self._provider.generate(
                system_prompt=SYSTEM_PROMPT,
                user_message=message,
                output_type=VerificationModelOutput,
                development_fallback=unavailable,
                max_tokens=1500,
                images=images or None,
            )
        clean, dropped = validate_verification(raw, request, documents)
        # Counts and scores only — never evidence text.
        logger.info(
            "evidence_verified",
            evidence_id=request.evidence_id,
            provider=info.provider,
            recommendation=clean.recommendation if ai_ran else None,
            confidence=clean.confidence,
            images=len(images),
            documents=len(documents),
            dropped=dropped,
            ms=int(elapsed.milliseconds),
        )
        return VerifyEvidenceResult(
            **clean.model_dump(exclude={"recommendation"}),
            recommendation=clean.recommendation if ai_ran else None,
            ai_ran=ai_ran,
            documents_read=len(documents),
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            prompt_version=PROMPT_VERSION,
            processing_ms=int(elapsed.milliseconds),
            dropped_items=dropped,
        )
