"""AI-assisted resolution verification (Prompt 22).

Internal only (shared token). Returns signals and an advisory recommendation
for one evidence item — never a decision. NestJS has already checked that the
caller may see the evidence and builds the bounded context; this service has
no database access and changes nothing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.schemas.verification import VerifyEvidenceRequest, VerifyEvidenceResult
from app.services.verification_service import VerificationService

logger = get_logger(__name__)

router = APIRouter(
    prefix="/verify",
    tags=["verification"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/evidence", response_model=VerifyEvidenceResult)
async def verify_evidence(
    request: VerifyEvidenceRequest, settings: SettingsDep
) -> VerifyEvidenceResult:
    try:
        return await VerificationService(build_provider(settings)).verify(request)
    except ProviderError as error:
        logger.warning("verification_failed", evidence_id=request.evidence_id, code=error.code)
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
                if error.code in {"PROVIDER_UNAVAILABLE", "TIMEOUT"}
                else status.HTTP_502_BAD_GATEWAY
            ),
            detail={"code": error.code, "message": error.message, "retryable": error.retryable},
        ) from error
    except Exception as error:  # noqa: BLE001 - never leak internals
        logger.exception("verification_unexpected_error", evidence_id=request.evidence_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PROVIDER_ERROR",
                "message": "Evidence verification failed unexpectedly.",
                "retryable": True,
            },
        ) from error
