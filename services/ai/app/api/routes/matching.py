"""Organisation matching endpoint.

Internal only, like embeddings. It scores candidates the API retrieved and
returns structured signals; the API persists them. This service has no
database access and decides nothing about allocation.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.embedding_base import EmbeddingProvider
from app.providers.embedding_factory import build_embedding_provider
from app.schemas.matching import MatchOrganizationsRequest, MatchOrganizationsResponse
from app.services.matching_service import MatchingService, build_engine

logger = get_logger(__name__)

router = APIRouter(
    prefix="/match",
    tags=["matching"],
    dependencies=[Depends(require_internal_token)],
)


def get_matching_service(settings: SettingsDep) -> MatchingService:
    provider: EmbeddingProvider | None
    try:
        provider = build_embedding_provider(settings)
    except ProviderError as error:
        # Matching still runs on the signals that need no encoder.
        logger.warning("matching_without_encoder", code=error.code)
        provider = None
    return MatchingService(build_engine(settings), provider)


MatchingServiceDep = Annotated[MatchingService, Depends(get_matching_service)]


@router.post("/organizations", response_model=MatchOrganizationsResponse)
async def match_organizations(
    request: MatchOrganizationsRequest,
    service: MatchingServiceDep,
) -> MatchOrganizationsResponse:
    """Scores and ranks candidate organisations for one problem.

    Scores are relevance, not probability: `final_score` is a weighted average
    of interpretable signals, and the response says which engine and weights
    produced it.
    """
    try:
        return await service.match(request)
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("organization_matching_failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Matching failed unexpectedly.",
                "retryable": True,
            },
        ) from error
