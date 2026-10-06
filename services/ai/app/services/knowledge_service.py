"""Knowledge ingestion (chunking) and answer generation — Prompt 20."""

from __future__ import annotations

import base64
import binascii
import re

from app.core.logging import get_logger
from app.knowledge.chunking import CHUNKER_VERSION, chunk
from app.knowledge.extraction import extract
from app.prompts.knowledge_answer import PROMPT_VERSION, SYSTEM_PROMPT, build_user_message
from app.providers.base import ProviderError, VisionLanguageProvider
from app.schemas.knowledge import (
    AnswerRequest,
    AnswerResult,
    ChunkOut,
    ChunkRequest,
    ChunkResponse,
    ModelAnswer,
)
from app.utils.timing import measure

logger = get_logger(__name__)

_CITATION = re.compile(r"\[(E\d{1,3})\]")


def chunk_document(request: ChunkRequest) -> ChunkResponse:
    with measure() as elapsed:
        if request.file_base64 is not None:
            try:
                data = base64.b64decode(request.file_base64, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ProviderError(
                    "MALFORMED_DOCUMENT", "The file could not be decoded.", retryable=False
                ) from error
        else:
            data = (request.text or "").encode("utf-8")
        if not data.strip():
            raise ProviderError("EMPTY_DOCUMENT", "The document is empty.", retryable=False)
        extracted = extract(data, request.mime_type)
        text = extracted.text
        if not text.strip():
            raise ProviderError(
                "EMPTY_DOCUMENT",
                "No text could be extracted from the document.",
                retryable=False,
            )
        chunks = chunk(
            extracted,
            max_tokens=request.max_tokens,
            overlap_tokens=request.overlap_tokens,
            min_tokens=request.min_tokens,
        )
        if len(chunks) > request.max_chunks:
            raise ProviderError(
                "DOCUMENT_TOO_LARGE",
                f"The document produces more than {request.max_chunks} chunks.",
                retryable=False,
            )
    # Counts and timings only — never document content in logs.
    logger.info(
        "knowledge_chunked", chunks=len(chunks), characters=len(text), ms=int(elapsed.milliseconds)
    )
    return ChunkResponse(
        detected_type=_detected(data, request.mime_type),
        page_count=extracted.page_count,
        character_count=len(text),
        chunks=[ChunkOut(**c.__dict__) for c in chunks],
        chunker_version=CHUNKER_VERSION,
        processing_ms=int(elapsed.milliseconds),
    )


def _detected(data: bytes, declared: str | None) -> str:
    from app.knowledge.extraction import detect_type

    return detect_type(data, declared)


class KnowledgeAnswerService:
    def __init__(self, provider: VisionLanguageProvider) -> None:
        self._provider = provider

    async def answer(self, request: AnswerRequest) -> AnswerResult:
        info = self._provider.info
        with measure() as elapsed:
            if not request.evidence:
                # Nothing to ground an answer in: say so without a model call.
                raw = ModelAnswer(
                    answer="The knowledge base does not contain enough information to answer this.",
                    insufficient_evidence=True,
                    evidence_refs=[],
                    suggestions=[],
                )
            else:
                raw = await self._provider.generate(
                    system_prompt=SYSTEM_PROMPT,
                    user_message=build_user_message(request),
                    output_type=ModelAnswer,
                    development_fallback=lambda: extractive_answer(request),
                    max_tokens=1500,
                )
        clean, dropped = validate_answer(raw, request)
        logger.info(
            "knowledge_answered",
            provider=info.provider,
            evidence=len(request.evidence),
            cited=len(clean.evidence_refs),
            insufficient=clean.insufficient_evidence,
            ms=int(elapsed.milliseconds),
        )
        return AnswerResult(
            **clean.model_dump(),
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            prompt_version=PROMPT_VERSION,
            processing_ms=int(elapsed.milliseconds),
            dropped_citations=dropped,
        )


def validate_answer(output: ModelAnswer, request: AnswerRequest) -> tuple[ModelAnswer, int]:
    """Citations must name provided evidence. Unknown markers are removed."""
    known = {item.ref for item in request.evidence}
    dropped = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal dropped
        if match.group(1) in known:
            return match.group(0)
        dropped += 1
        return ""

    answer = _CITATION.sub(replace, output.answer).strip()
    cited_in_text = set(_CITATION.findall(answer))
    refs = [ref for ref in dict.fromkeys([*output.evidence_refs, *cited_in_text]) if ref in known]
    dropped += len([ref for ref in output.evidence_refs if ref not in known])
    insufficient = output.insufficient_evidence or not refs
    if not answer:
        answer = "The knowledge base does not contain enough information to answer this."
        insufficient = True
    return (
        ModelAnswer(
            answer=answer[:4000],
            insufficient_evidence=insufficient,
            evidence_refs=refs,
            suggestions=[s.strip()[:400] for s in output.suggestions if s.strip()][:5],
        ),
        dropped,
    )


def extractive_answer(request: AnswerRequest) -> ModelAnswer:
    """Development provider: quotes the top passages. No model ran."""
    lines = ["Development provider — no AI model ran. The most relevant passages are:"]
    for item in request.evidence[:3]:
        first = re.split(r"(?<=[.!?])\s+", item.content.strip())[0][:300]
        lines.append(
            f"{item.title}{' — ' + item.section if item.section else ''}: {first} [{item.ref}]"
        )
    return ModelAnswer(
        answer="\n".join(lines),
        insufficient_evidence=False,
        evidence_refs=[item.ref for item in request.evidence[:3]],
        suggestions=[],
    )
