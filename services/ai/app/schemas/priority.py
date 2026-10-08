"""AI-assisted priority features — Prompt 21.

NestJS sends what is already known about one problem (the report, the latest
analysis, a coarse locality). This service asks the model for a few bounded
*signals* — never a priority score or tier — each with a confidence and short
evidence quoted from the input. The score is computed by NestJS's scoring
engine; the model only contributes features to it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analysis import CategoryLiteral, LevelLiteral


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class PriorityFeatureRequest(_Strict):
    problem_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=4000)
    category: CategoryLiteral
    subcategory: str | None = Field(default=None, max_length=120)
    # From the latest completed AI analysis, when there is one.
    severity: LevelLiteral | None = None
    urgency: LevelLiteral | None = None
    analysis_summary: str | None = Field(default=None, max_length=600)
    observations: list[str] = Field(default_factory=list, max_length=5)
    # Coarse area only ("Kothrud, Pune") — never coordinates or a full address.
    locality: str | None = Field(default=None, max_length=200)


class ModelSignal(_Strict):
    """One signal. ``value`` is null when the input does not support a judgement."""

    value: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    # Short phrases quoted or closely paraphrased from the input.
    evidence: list[str] = Field(default_factory=list, max_length=3)


class StatedCount(_Strict):
    """A number of affected people *stated in the report* — never an estimate."""

    value: int | None = Field(default=None, ge=1, le=10_000_000)
    unit: Literal["people", "households", "unknown"] = "unknown"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list, max_length=2)


class PriorityModelOutput(_Strict):
    """What the model must return. No score, no tier, no reasoning field."""

    safety_risk: ModelSignal
    urgency: ModelSignal
    impact_breadth: ModelSignal
    stated_affected: StatedCount


class PriorityFeatureResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    safety_risk: ModelSignal
    urgency: ModelSignal
    impact_breadth: ModelSignal
    stated_affected: StatedCount
    # False for the development provider: every signal is then null.
    ai_ran: bool
    provider: str
    model_name: str
    model_version: str
    prompt_version: str
    processing_ms: int
    # Evidence phrases removed because they could not be found in the input.
    dropped_evidence: int = 0
