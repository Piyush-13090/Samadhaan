"""Analytics insights (Prompt 24).

Internal only (shared token). Summarises facts NestJS computed; every
statement cites the facts it rests on. Has no database access and changes
nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.insights import InsightRequest, InsightResult
from app.services.insights_service import InsightService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/insights", response_model=InsightResult)
async def analytics_insights(request: InsightRequest, settings: SettingsDep) -> InsightResult:
    try:
        return await InsightService(build_provider(settings)).summarise(request)
    except ProviderError as error:
        logger.warning("analytics_insights_failed", code=error.code)
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
                if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
                else status.HTTP_502_BAD_GATEWAY
            ),
            detail={"code": error.code, "message": error.message, "retryable": error.retryable},
        ) from error
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("analytics_insights_unexpected_error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Insight generation failed unexpectedly.",
                "retryable": True,
            },
        ) from error
