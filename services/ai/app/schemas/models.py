"""Contracts for registry-backed model inference (Prompt 28).

The caller (the NestJS API) names the exact artifact — task, version and the
sha256 its registry approved. The service never chooses a model itself and
never accepts a file path.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.taxonomy import CATEGORIES

Task = Literal["problem_category", "problem_severity", "problem_urgency", "duplicate_pair"]


class ArtifactRef(BaseModel):
    task: Task
    version: str = Field(min_length=1, max_length=100)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ProblemTextInput(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = None

    @model_validator(mode="after")
    def _category_in_taxonomy(self) -> ProblemTextInput:
        if self.category is not None and self.category not in CATEGORIES:
            raise ValueError("category is not in the taxonomy")
        return self


class DuplicateSignalsInput(BaseModel):
    text_similarity: float | None = Field(default=None, ge=0, le=1)
    geographic_similarity: float | None = Field(default=None, ge=0, le=1)
    category_similarity: float | None = Field(default=None, ge=0, le=1)
    image_similarity: float | None = Field(default=None, ge=0, le=1)


class PredictRequest(ArtifactRef):
    input: dict[str, object]


class VerifyResponse(BaseModel):
    ok: Literal[True] = True
    task: Task
    version: str
    sha256: str
    feature_schema_version: str
    label_schema_version: str
    labels: list[str]
    synthetic_data: bool


class PredictResponse(BaseModel):
    task: Task
    version: str
    label: str | None
    confidence: float
    probabilities: dict[str, float]
    abstained: bool
    abstain_reason: str | None
    missing_features: list[str]
    feature_schema_version: str
    latency_ms: int
    advisory: Literal[True] = True
    """Every prediction from a trained model is advisory: it never changes a
    problem's category, severity, duplicate status or resolution by itself."""
