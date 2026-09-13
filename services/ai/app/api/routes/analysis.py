"""Problem analysis endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.analysis import AnalysisResult, AnalyzeProblemRequest
from app.services.analysis_service import AnalysisService

logger = get_logger(__name__)

# Guarded by the shared internal token: unlike the health endpoints, this one
# costs money per call and must only be reachable through the NestJS API.
router = APIRouter(
    prefix="/analyze",
    tags=["analysis"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/problem", response_model=AnalysisResult)
async def analyze_problem(
    request: AnalyzeProblemRequest,
    settings: SettingsDep,
) -> AnalysisResult:
    """Analyses one civic problem from its images and description.

    Failures are returned as a structured error the caller can act on — in
    particular `retryable`, which decides whether NestJS tries again or marks
    the analysis FAILED. Nothing is ever fabricated: an unconfigured provider
    is a 503, not a guess.
    """
    try:
        provider = build_provider(settings)
        service = AnalysisService(provider, settings)
        return await service.analyze(request)

    except ProviderError as error:
        logger.warning(
            "analysis_failed",
            problem_id=request.problem_id,
            code=error.code,
            retryable=error.retryable,
            # `error.message` is written for a caller, never the provider's own
            # text — that could carry request detail we should not echo.
            detail=error.message,
        )

        # 503 for "the capability is unavailable", 502 for "the upstream
        # misbehaved". The distinction matters to whoever is on call.
        http_status = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
            else status.HTTP_502_BAD_GATEWAY
        )

        raise HTTPException(
            status_code=http_status,
            detail={
                "code": error.code,
                "message": error.message,
                "retryable": error.retryable,
            },
        ) from error

    except Exception as error:  # noqa: BLE001 - the endpoint must not leak internals
        logger.exception("analysis_unexpected_error", problem_id=request.problem_id)

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Analysis failed unexpectedly.",
                "retryable": True,
            },
        ) from error
