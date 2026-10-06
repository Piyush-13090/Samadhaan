"""Request and response contracts for organisation matching.

The API computes everything that needs the database — vector similarity via
pgvector, distance via PostGIS, activity counts — and sends those numbers
here with each candidate's public profile facts. This service turns them into
signals and a ranking. It never sees vectors, coordinates, people or contact
details, and it never writes to any database.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.taxonomy import CATEGORIES, SEVERITIES

OrganizationType = Literal["NGO", "UNIVERSITY", "INDUSTRY"]
ExpertiseLevel = Literal["SPECIALIST", "EXPERIENCED", "INTERESTED"]


def _category(value: str | None) -> str | None:
    if value is None:
        return None
    if value not in CATEGORIES:
        raise ValueError(f"unknown category {value!r}")
    return value


class MatchProblem(BaseModel):
    public_id: str | None = Field(default=None, max_length=32)
    """For logs only."""

    category: str
    ai_category: str | None = None
    subcategory: str | None = Field(default=None, max_length=120)
    ai_subcategory: str | None = Field(default=None, max_length=120)
    severity: str | None = None

    focus_text: str = Field(min_length=1, max_length=6000)
    """Title, description, AI summary and category — the public civic record,
    never anything about the reporter."""

    _check_category = field_validator("category", "ai_category")(_category)

    @field_validator("severity")
    @classmethod
    def _check_severity(cls, value: str | None) -> str | None:
        if value is not None and value not in SEVERITIES:
            raise ValueError(f"unknown severity {value!r}")
        return value


class MatchExpertise(BaseModel):
    category: str
    subcategory: str | None = Field(default=None, max_length=120)
    level: ExpertiseLevel

    _check_category = field_validator("category")(_category)


class MatchCandidate(BaseModel):
    organization_id: str = Field(min_length=1, max_length=64)
    type: OrganizationType
    expertise: list[MatchExpertise] = Field(default_factory=list, max_length=30)

    semantic_similarity: float | None = Field(default=None, ge=-1.0, le=1.0)
    """Cosine similarity between the problem's and the organisation's profile
    embeddings, computed by pgvector. Null when the organisation has no
    embedding yet."""

    distance_meters: float | None = Field(default=None, ge=0)
    same_city: bool = False
    has_location: bool = False

    relevant_activity_count: int = Field(default=0, ge=0, le=10_000)
    """Suggestions this organisation made on problems in the same category."""


class MatchOptions(BaseModel):
    result_limit: int = Field(default=10, ge=1, le=50)
    min_score: float = Field(default=0.3, ge=0.0, le=1.0)


class MatchOrganizationsRequest(BaseModel):
    problem: MatchProblem
    candidates: list[MatchCandidate] = Field(default_factory=list, max_length=200)
    options: MatchOptions = Field(default_factory=MatchOptions)


class MatchSignals(BaseModel):
    """Each signal 0–1, or null when it could not be computed."""

    semantic: float | None
    expertise: float | None
    category: float | None
    geographic: float | None
    capability: float | None
    activity: float | None


ReasonCode = Literal[
    "EXPERTISE_STRONG",
    "EXPERTISE_RELATED",
    "SEMANTIC_HIGH",
    "SEMANTIC_MODERATE",
    "WITHIN_SERVICE_AREA",
    "SAME_CITY",
    "IN_REGION",
    "TYPE_FIT",
    "RELATED_ACTIVITY",
]


class MatchReason(BaseModel):
    """One piece of evidence. The UI words it; nothing here is prose."""

    code: ReasonCode
    signal: str
    value: float


class OrganizationMatch(BaseModel):
    organization_id: str
    rank: int
    final_score: float
    """Weighted relevance, 0–1. **Not** a calibrated probability."""

    signals: MatchSignals
    reasons: list[MatchReason]
    matched_expertise: list[int]
    """Indexes into the candidate's `expertise`, strongest first."""


class MatchModelInfo(BaseModel):
    engine: str
    engine_version: str
    matching_version: str
    """Engine, version and a hash of every weight and threshold. Two results
    with the same matching_version were produced by the same rules."""

    weights: dict[str, float]
    embedding_model: str | None
    trained: bool
    """Always false for the heuristic baseline."""


class MatchOrganizationsResponse(BaseModel):
    matches: list[OrganizationMatch]
    considered: int
    degraded: list[str]
    """Signals that could not be computed this time (e.g. the encoder was
    unavailable); their weight was redistributed."""

    model: MatchModelInfo
    processing_ms: int


__all__ = [
    "MatchCandidate",
    "MatchExpertise",
    "MatchModelInfo",
    "MatchOptions",
    "MatchOrganizationsRequest",
    "MatchOrganizationsResponse",
    "MatchProblem",
    "MatchReason",
    "MatchSignals",
    "OrganizationMatch",
]
