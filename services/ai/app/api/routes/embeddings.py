"""Embedding generation endpoint.

Internal only. Embeddings are the substrate of duplicate detection: exposing
this publicly would let anyone mine the vector space, and would let a caller
generate vectors this service never wrote to its own database.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.embedding_factory import build_embedding_provider
from app.schemas.embedding import EmbedTextRequest, EmbedTextResponse
from app.services.embedding_service import EmbeddingService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/embeddings",
    tags=["embeddings"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/text", response_model=EmbedTextResponse)
async def embed_text(
    request: EmbedTextRequest,
    settings: SettingsDep,
) -> EmbedTextResponse:
    """Encodes one or more texts into vectors.

    The response carries `model_name`, `model_version` and `dimensions`, all of
    which the caller must store: vectors from different models are not
    comparable, and a similarity computed across them is a plausible-looking
    number with no meaning.
    """
    try:
        provider = build_embedding_provider(settings)
        service = EmbeddingService(provider)
        return await service.embed_text(request)

    except ProviderError as error:
        logger.warning(
            "embedding_failed",
            code=error.code,
            retryable=error.retryable,
            detail=error.message,
        )

        http_status = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
            else status.HTTP_502_BAD_GATEWAY
        )
        if error.code in {"INVALID_INPUT", "DIMENSION_MISMATCH"}:
            # A caller-side or deployment-side fault, not an upstream one.
            http_status = status.HTTP_400_BAD_REQUEST

        raise HTTPException(
            status_code=http_status,
            detail={
                "code": error.code,
                "message": error.message,
                "retryable": error.retryable,
            },
        ) from error

    except Exception as error:  # noqa: BLE001 - the endpoint must not leak internals
        logger.exception("embedding_unexpected_error")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Embedding failed unexpectedly.",
                "retryable": True,
            },
        ) from error
