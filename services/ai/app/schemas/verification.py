"""AI-assisted resolution verification — Prompt 22.

NestJS sends a bounded verification context for one evidence item: the
original problem, the project's progress, the evidence's metadata, its images
(with the problem's original "before" photos), document files, and supporting
civic guidance. This service returns bounded *signals* and an advisory
recommendation from a controlled vocabulary that deliberately has no
"RESOLVED": only a government official decides that.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analysis import AnalysisImage, CategoryLiteral

Recommendation = Literal[
    "INSUFFICIENT_EVIDENCE",
    "POSSIBLY_RESOLVED",
    "LIKELY_RESOLVED",
    "LIKELY_NOT_RESOLVED",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class VerificationProblem(_Strict):
    public_id: str = Field(max_length=32)
    title: str = Field(max_length=200)
    description: str = Field(max_length=4000)
    category: CategoryLiteral
    subcategory: str | None = Field(default=None, max_length=120)
    analysis_summary: str | None = Field(default=None, max_length=600)
    observations: list[str] = Field(default_factory=list, max_length=5)


class VerificationProject(_Strict):
    name: str = Field(max_length=200)
    status: str = Field(max_length=20)
    task_progress: int = Field(ge=0, le=100)
    open_tasks: int = Field(ge=0)
    completed_tasks: int = Field(ge=0)
    # "Title — status" lines, bounded.
    milestones: list[str] = Field(default_factory=list, max_length=8)
    tasks: list[str] = Field(default_factory=list, max_length=10)


class EvidenceFileRef(_Strict):
    """One file of the evidence, as the model may cite it (F1, F2…)."""

    ref: str = Field(pattern=r"^F\d{1,2}$")
    kind: Literal["image", "document", "video", "other"]
    role: Literal["BEFORE", "AFTER", "DOCUMENT", "OTHER"]
    # Derived by NestJS; never raw coordinates.
    captured: str | None = Field(default=None, max_length=60)
    distance_from_problem_m: int | None = Field(default=None, ge=0)


class EvidenceImage(_Strict):
    ref: str = Field(pattern=r"^(F\d{1,2}|B\d)$")
    image: AnalysisImage


class EvidenceDocument(_Strict):
    ref: str = Field(pattern=r"^F\d{1,2}$")
    # Base64 PDF/text bytes; text is extracted here.
    file_base64: str = Field(max_length=14_000_000)


class GuidanceRef(_Strict):
    ref: str = Field(pattern=r"^G\d$")
    title: str = Field(max_length=300)
    section: str | None = Field(default=None, max_length=300)
    excerpt: str = Field(max_length=1500)


class VerifyEvidenceRequest(_Strict):
    evidence_id: str = Field(min_length=1, max_length=64)
    problem: VerificationProblem
    project: VerificationProject
    evidence_type: str = Field(max_length=40)
    title: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    files: list[EvidenceFileRef] = Field(default_factory=list, max_length=12)
    # The problem's original report photos (B1, B2) and this evidence's images.
    before_images: list[EvidenceImage] = Field(default_factory=list, max_length=2)
    after_images: list[EvidenceImage] = Field(default_factory=list, max_length=4)
    documents: list[EvidenceDocument] = Field(default_factory=list, max_length=2)
    # Earlier evidence for the same project: "type: title — description".
    other_evidence: list[str] = Field(default_factory=list, max_length=5)
    guidance: list[GuidanceRef] = Field(default_factory=list, max_length=3)


class Signal(_Strict):
    """One signal. ``value`` is null when the evidence does not allow a judgement."""

    value: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)


class Observation(_Strict):
    """A short factual observation, citing the files (F1, B1) or guidance (G1) it rests on."""

    text: str = Field(max_length=240)
    refs: list[str] = Field(default_factory=list, max_length=4)


class VerificationModelOutput(_Strict):
    """What the model must return. No reasoning field, and no "RESOLVED"."""

    relevance: Signal
    visual_consistency: Signal
    completion_signals: Signal
    documentation: Signal
    recommendation: Recommendation
    confidence: float = Field(ge=0.0, le=1.0)
    supporting: list[Observation] = Field(default_factory=list, max_length=5)
    remaining_issues: list[Observation] = Field(default_factory=list, max_length=5)


class VerifyEvidenceResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    relevance: Signal
    visual_consistency: Signal
    completion_signals: Signal
    documentation: Signal
    # Null when no model ran (development provider): no recommendation is claimed.
    recommendation: Recommendation | None
    confidence: float
    supporting: list[Observation]
    remaining_issues: list[Observation]
    ai_ran: bool
    documents_read: int
    provider: str
    model_name: str
    model_version: str
    prompt_version: str
    processing_ms: int
    dropped_items: int = 0
