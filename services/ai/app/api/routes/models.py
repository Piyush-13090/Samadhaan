"""Registry-backed model inference (Prompt 28). Internal only.

`/models/verify` lets the API check an artifact before activating it;
`/models/predict` serves a prediction from an exact, approved artifact. Inputs
are validated against the task's schema; failures carry a code the API maps to
its fallback (the existing provider path), never to an invented answer.
Logs record task, version, outcome and latency — never the input text.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import anyio
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from app.api.deps import SettingsDep
from app.core.logging import get_logger
from app.core.security import require_internal_token
from app.models.artifacts import ArtifactError, LoadedArtifact
from app.models.store import store_for
from app.models.tasks import TASKS
from app.schemas.models import (
    ArtifactRef,
    DuplicateSignalsInput,
    PredictRequest,
    PredictResponse,
    ProblemTextInput,
    VerifyResponse,
)

logger = get_logger(__name__)

router = APIRouter(
    prefix="/models", tags=["models"], dependencies=[Depends(require_internal_token)]
)

_STATUS = {
    "INVALID_NAME": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "INTEGRITY": status.HTTP_409_CONFLICT,
    "INCOMPATIBLE": status.HTTP_409_CONFLICT,
    "CORRUPT": status.HTTP_409_CONFLICT,
}


def _load(ref: ArtifactRef, root: str) -> LoadedArtifact:
    try:
        return store_for(str(Path(root))).get(ref.task, ref.version, ref.sha256)
    except ArtifactError as error:
        logger.warning(
            "model_artifact_refused", task=ref.task, version=ref.version, code=error.code
        )
        raise HTTPException(
            status_code=_STATUS[error.code],
            detail={"code": f"ARTIFACT_{error.code}", "message": error.message, "retryable": False},
        ) from error


@router.post("/verify", response_model=VerifyResponse)
async def verify(ref: ArtifactRef, settings: SettingsDep) -> VerifyResponse:
    loaded = await anyio.to_thread.run_sync(_load, ref, settings.ml_artifact_dir)
    return VerifyResponse(
        task=ref.task,
        version=ref.version,
        sha256=loaded.sha256,
        feature_schema_version=loaded.feature_schema,
        label_schema_version=loaded.label_schema,
        labels=list(loaded.model.labels),
        synthetic_data=loaded.synthetic,
    )


def _validated_input(task: str, raw: dict[str, Any]) -> dict[str, Any]:
    model = DuplicateSignalsInput if TASKS[task].kind == "binary_signals" else ProblemTextInput
    return model.model_validate(raw).model_dump()


@router.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest, settings: SettingsDep) -> PredictResponse:
    started = time.perf_counter()
    try:
        inputs = _validated_input(request.task, request.input)
    except ValidationError as error:
        logger.info("model_input_rejected", task=request.task, version=request.version)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "INPUT_SCHEMA",
                "message": "input does not match the task schema",
                "fields": sorted({str(e["loc"][0]) for e in error.errors() if e["loc"]}),
                "retryable": False,
            },
        ) from error

    loaded = await anyio.to_thread.run_sync(_load, request, settings.ml_artifact_dir)
    prediction = loaded.model.predict(inputs)
    latency_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "model_prediction",
        task=request.task,
        version=request.version,
        abstained=prediction.abstained,
        latency_ms=latency_ms,
    )
    return PredictResponse(
        task=request.task,
        version=request.version,
        label=prediction.label,
        confidence=prediction.confidence,
        probabilities=prediction.probabilities,
        abstained=prediction.abstained,
        abstain_reason=prediction.abstain_reason,
        missing_features=prediction.missing_features,
        feature_schema_version=loaded.feature_schema,
        latency_ms=latency_ms,
    )
