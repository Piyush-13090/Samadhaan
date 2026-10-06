"""AI Project Coordinator endpoints (Prompt 19).

Internal only (shared token), like analysis: they cost money per call and are
reached through the NestJS API, which has already checked that the caller may
see the project. This service reads the context it is sent and returns advice;
it has no database access and changes nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.coordinator import (
    CoordinatorRequest,
    CoordinatorResult,
    ExtractUpdateRequest,
    ExtractUpdateResult,
)
from app.services.coordinator_service import CoordinatorService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/coordinator",
    tags=["coordinator"],
    dependencies=[Depends(require_internal_token)],
)


def _http_error(error: ProviderError) -> HTTPException:
    return HTTPException(
        status_code=(
            status.HTTP_503_SERVICE_UNAVAILABLE
            if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
            else status.HTTP_502_BAD_GATEWAY
        ),
        detail={"code": error.code, "message": error.message, "retryable": error.retryable},
    )


def _unexpected() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={
            "code": "PROVIDER_ERROR",
            "message": "The coordinator failed unexpectedly.",
            "retryable": True,
        },
    )


@router.post("/analyze", response_model=CoordinatorResult)
async def analyze_project(request: CoordinatorRequest, settings: SettingsDep) -> CoordinatorResult:
    try:
        return await CoordinatorService(build_provider(settings)).analyze(request)
    except ProviderError as error:
        logger.warning("coordinator_failed", project_id=request.project_id, code=error.code)
        raise _http_error(error) from error
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("coordinator_unexpected_error", project_id=request.project_id)
        raise _unexpected() from error


@router.post("/extract-update", response_model=ExtractUpdateResult)
async def extract_update(
    request: ExtractUpdateRequest, settings: SettingsDep
) -> ExtractUpdateResult:
    try:
        return await CoordinatorService(build_provider(settings)).extract_update(request)
    except ProviderError as error:
        logger.warning("update_extraction_failed", code=error.code)
        raise _http_error(error) from error
    except Exception as error:  # noqa: BLE001
        logger.exception("update_extraction_unexpected_error")
        raise _unexpected() from error
