"""Knowledge (RAG) endpoints — Prompt 20.

Internal only. The NestJS API authorises the caller, retrieves only the
passages they may see, and sends them here. This service has no database
access: it cannot retrieve, and so cannot leak, anything it was not given.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.knowledge import AnswerRequest, AnswerResult, ChunkRequest, ChunkResponse
from app.services.knowledge_service import KnowledgeAnswerService, chunk_document

logger = get_logger(__name__)

router = APIRouter(
    prefix="/knowledge",
    tags=["knowledge"],
    dependencies=[Depends(require_internal_token)],
)

_CLIENT_ERRORS = {
    "EMPTY_DOCUMENT",
    "MALFORMED_DOCUMENT",
    "UNSUPPORTED_DOCUMENT",
    "DOCUMENT_TOO_LARGE",
}


def _error(error: ProviderError) -> HTTPException:
    code = (
        status.HTTP_422_UNPROCESSABLE_ENTITY
        if error.code in _CLIENT_ERRORS
        else status.HTTP_503_SERVICE_UNAVAILABLE
        if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
        else status.HTTP_502_BAD_GATEWAY
    )
    return HTTPException(
        status_code=code,
        detail={"code": error.code, "message": error.message, "retryable": error.retryable},
    )


@router.post("/chunk", response_model=ChunkResponse)
async def chunk(request: ChunkRequest) -> ChunkResponse:
    try:
        return chunk_document(request)
    except ProviderError as error:
        logger.warning("knowledge_chunk_failed", code=error.code)
        raise _error(error) from error


@router.post("/answer", response_model=AnswerResult)
async def answer(request: AnswerRequest, settings: SettingsDep) -> AnswerResult:
    try:
        return await KnowledgeAnswerService(build_provider(settings)).answer(request)
    except ProviderError as error:
        logger.warning("knowledge_answer_failed", code=error.code)
        raise _error(error) from error
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("knowledge_answer_unexpected_error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "PROVIDER_ERROR", "message": "Answering failed.", "retryable": True},
        ) from error
