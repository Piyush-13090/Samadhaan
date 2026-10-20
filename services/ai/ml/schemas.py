"""Dataset schemas, one per task (Prompt 28).

Each task has its own record shape; nothing is forced into one generic table.
Every record carries a `label_source`, and only independent human judgement
is accepted as a label. AI outputs, heuristic scores and citizen
self-selection may appear as *baseline* columns to be evaluated, never as the
label being learned.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.taxonomy import CATEGORIES, SEVERITIES, URGENCIES

#: Label provenance accepted as ground truth.
ACCEPTED_LABEL_SOURCES = frozenset({"HUMAN_REVIEWED", "EXPERT_ADJUDICATED", "GOVERNMENT_DECISION"})
#: Recognised, but never accepted as a label (named so the error can say why).
REJECTED_LABEL_SOURCES = frozenset(
    {"AI_GENERATED", "MODEL_OUTPUT", "HEURISTIC", "CITIZEN_SELF_REPORTED", "UNKNOWN"}
)

Text = Annotated[str, Field(min_length=1, max_length=5000)]
Id = Annotated[str, Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._:-]+$")]
Region = Annotated[str, Field(min_length=1, max_length=120)]


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    record_id: Id
    label_source: str
    created_at: datetime | None = None
    city: Region | None = None

    @field_validator("label_source")
    @classmethod
    def _independent_label(cls, value: str) -> str:
        value = value.strip().upper()
        if value in REJECTED_LABEL_SOURCES:
            raise ValueError(f"label_source {value} is not independent ground truth")
        if value not in ACCEPTED_LABEL_SOURCES:
            raise ValueError(f"label_source must be one of {sorted(ACCEPTED_LABEL_SOURCES)}")
        return value


def _in(allowed: tuple[str, ...], name: str):
    def check(value: str | None) -> str | None:
        if value is None:
            return None
        canonical = value.strip().upper()
        if canonical not in allowed:
            raise ValueError(f"{name} {value!r} is not in the Samadhaan taxonomy")
        return canonical

    return check


class ProblemCategoryRecord(_Record):
    """Problem classification: text in, reviewed category (and optional subcategory) out."""

    incident_id: Id | None = None
    title: Text
    description: Text
    category: str
    subcategory: Annotated[str, Field(max_length=80)] | None = None
    baseline_category: str | None = None
    """The existing system's output for this report (e.g. the LLM analysis), for
    baseline comparison only."""

    _cat = field_validator("category", "baseline_category")(_in(CATEGORIES, "category"))

    @field_validator("subcategory")
    @classmethod
    def _subcategory(cls, value: str | None) -> str | None:
        # Subcategories are free text in Samadhaan (suggestions, not a closed
        # list), so they are normalised, not validated against an enum.
        return " ".join(value.lower().split()) or None if value else None


class ProblemSeverityRecord(_Record):
    incident_id: Id | None = None
    title: Text
    description: Text
    category: str | None = None
    severity: str
    baseline_severity: str | None = None

    _cat = field_validator("category")(_in(CATEGORIES, "category"))
    _sev = field_validator("severity", "baseline_severity")(_in(SEVERITIES, "severity"))


class ProblemUrgencyRecord(_Record):
    incident_id: Id | None = None
    title: Text
    description: Text
    category: str | None = None
    urgency: str
    baseline_urgency: str | None = None

    _cat = field_validator("category")(_in(CATEGORIES, "category"))
    _urg = field_validator("urgency", "baseline_urgency")(_in(URGENCIES, "urgency"))


Signal = Annotated[float, Field(ge=0, le=1)]


class DuplicatePairRecord(_Record):
    """A reviewed candidate pair. Problem ids are pseudonymous; the pair's two
    problems are grouped together when splitting, so one incident never sits on
    both sides of an evaluation."""

    problem_a: Id
    problem_b: Id
    text_similarity: Signal | None = None
    geographic_similarity: Signal | None = None
    category_similarity: Signal | None = None
    image_similarity: Signal | None = None
    baseline_score: Signal | None = None
    is_duplicate: bool


class OrganizationRelevanceRecord(_Record):
    """Graded relevance (0–3) of an organisation to a problem, judged by a
    reviewer — not an allocation outcome, which also reflects capacity."""

    query_id: Id
    organization_id: Id
    relevance: Annotated[int, Field(ge=0, le=3)]
    system_score: float | None = None
    organization_size: Literal["SMALL", "MEDIUM", "LARGE"] | None = None


class VerificationOutcomeRecord(_Record):
    """A reviewed resolution-evidence outcome, with the system's recommendation
    (if any) as the baseline being evaluated."""

    evidence_id: Id
    project_id: Id | None = None
    outcome: Literal["RESOLVED", "NOT_RESOLVED", "INSUFFICIENT_EVIDENCE"]
    system_recommendation: (
        Literal[
            "INSUFFICIENT_EVIDENCE", "POSSIBLY_RESOLVED", "LIKELY_RESOLVED", "LIKELY_NOT_RESOLVED"
        ]
        | None
    ) = None


class RetrievalJudgementRecord(_Record):
    query_id: Id
    document_id: Id
    relevance: Annotated[int, Field(ge=0, le=3)]
    system_score: float | None = None


class PriorityJudgementRecord(_Record):
    """An expert-adjudicated priority tier for a problem, with the engine's score."""

    problem_id: Id
    expert_tier: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    engine_score: Annotated[float, Field(ge=0, le=100)] | None = None


RECORD_SCHEMAS: dict[str, type[_Record]] = {
    "problem_category": ProblemCategoryRecord,
    "problem_severity": ProblemSeverityRecord,
    "problem_urgency": ProblemUrgencyRecord,
    "duplicate_pair": DuplicatePairRecord,
    "organization_relevance": OrganizationRelevanceRecord,
    "verification_outcome": VerificationOutcomeRecord,
    "retrieval_judgement": RetrievalJudgementRecord,
    "priority_judgement": PriorityJudgementRecord,
}

#: Fields holding free text that is redacted during preprocessing.
TEXT_FIELDS = ("title", "description")

#: The field each task learns or is evaluated against.
LABEL_FIELD: dict[str, str] = {
    "problem_category": "category",
    "problem_severity": "severity",
    "problem_urgency": "urgency",
    "duplicate_pair": "is_duplicate",
    "organization_relevance": "relevance",
    "verification_outcome": "outcome",
    "retrieval_judgement": "relevance",
    "priority_judgement": "expert_tier",
}


class DatasetManifest(BaseModel):
    """`dataset.json`, next to the records. Provenance is mandatory."""

    model_config = ConfigDict(extra="forbid")

    name: Id
    version: Id
    task: Literal[
        "problem_category",
        "problem_severity",
        "problem_urgency",
        "duplicate_pair",
        "organization_relevance",
        "verification_outcome",
        "retrieval_judgement",
        "priority_judgement",
    ]
    records_file: str = Field(pattern=r"^[A-Za-z0-9._-]+\.(jsonl|csv)$")
    description: str = Field(min_length=1, max_length=2000)
    owner: str = Field(min_length=1, max_length=200)
    permitted_uses: list[Literal["training", "evaluation"]] = Field(min_length=1)
    retention: str = Field(min_length=1, max_length=500)
    collection: str = Field(min_length=1, max_length=2000)
    """How the records and labels were collected and reviewed."""
    consent_basis: str = Field(min_length=1, max_length=500)
    contains_personal_data: bool
    synthetic: bool = False
    created_at: datetime
