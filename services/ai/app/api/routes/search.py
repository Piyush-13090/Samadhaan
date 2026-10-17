"""Search query understanding (Prompt 25).

Internal only (shared token). Returns enum-bounded filters for one query;
never SQL. Has no database access and changes
nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.search import UnderstandRequest, UnderstandResult
from app.services.search_service import SearchUnderstandingService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/search",
    tags=["search"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/understand", response_model=UnderstandResult)
async def understand_search(request: UnderstandRequest, settings: SettingsDep) -> UnderstandResult:
    try:
        return await SearchUnderstandingService(build_provider(settings)).understand(request)
    except ProviderError as error:
        logger.warning("search_understanding_failed", code=error.code)
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
                if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
                else status.HTTP_502_BAD_GATEWAY
            ),
            detail={"code": error.code, "message": error.message, "retryable": error.retryable},
        ) from error
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("search_understanding_unexpected_error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Query understanding failed unexpectedly.",
                "retryable": True,
            },
        ) from error
