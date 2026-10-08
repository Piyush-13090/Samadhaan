"""AI-assisted priority features (Prompt 21).

Internal only (shared token). Returns bounded signals with confidence and
evidence for NestJS's scoring engine — never a priority score or tier. Has no
database access and changes nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.priority import PriorityFeatureRequest, PriorityFeatureResult
from app.services.priority_service import PriorityFeatureService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/priority",
    tags=["priority"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/features", response_model=PriorityFeatureResult)
async def priority_features(
    request: PriorityFeatureRequest, settings: SettingsDep
) -> PriorityFeatureResult:
    try:
        return await PriorityFeatureService(build_provider(settings)).extract(request)
    except ProviderError as error:
        logger.warning("priority_features_failed", problem_id=request.problem_id, code=error.code)
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
                if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
                else status.HTTP_502_BAD_GATEWAY
            ),
            detail={"code": error.code, "message": error.message, "retryable": error.retryable},
        ) from error
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("priority_features_unexpected_error", problem_id=request.problem_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Priority feature extraction failed unexpectedly.",
                "retryable": True,
            },
        ) from error
