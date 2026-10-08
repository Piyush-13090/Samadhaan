"""Analytics insights — Prompt 24.

NestJS computes every metric in PostgreSQL and sends them here as labelled
*facts*. The model only summarises those facts in plain language. It cannot
add numbers, causes or recommendations of its own: each statement must cite
the fact keys it rests on, and the service checks every number it uses
against the facts before anything is returned.

Reference guidance (from the public knowledge base) is sent separately and
any note about it is kept separate from observations about the data.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


FactKey = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z][a-zA-Z0-9_.:-]*$")


class InsightFact(_Strict):
    key: str = FactKey
    label: str = Field(min_length=1, max_length=160)
    # Already formatted for reading, e.g. "42", "61%", "3.5 days".
    value: str = Field(min_length=1, max_length=80)
    # A deterministic signal NestJS attached (never inferred here).
    signal: Literal["increase", "decrease", "bottleneck", "attention"] | None = None


class InsightGuidance(_Strict):
    ref: str = Field(min_length=1, max_length=16, pattern=r"^[A-Z][0-9]{1,3}$")
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=1500)


class InsightRequest(_Strict):
    scope: Literal["government", "organization"] = "government"
    period_label: str = Field(min_length=1, max_length=120)
    facts: list[InsightFact] = Field(min_length=1, max_length=60)
    guidance: list[InsightGuidance] = Field(default_factory=list, max_length=3)


class InsightStatement(_Strict):
    text: str = Field(min_length=1, max_length=400)
    metric_keys: list[str] = Field(default_factory=list, max_length=6)


class GuidanceNote(_Strict):
    text: str = Field(min_length=1, max_length=400)
    refs: list[str] = Field(default_factory=list, max_length=3)


class InsightModelOutput(_Strict):
    """What the model must return. No reasoning field, no free-form numbers."""

    summary: str = Field(min_length=1, max_length=600)
    observations: list[InsightStatement] = Field(default_factory=list, max_length=5)
    attention: list[InsightStatement] = Field(default_factory=list, max_length=3)
    guidance_notes: list[GuidanceNote] = Field(default_factory=list, max_length=2)


class InsightResult(InsightModelOutput):
    ai_ran: bool
    provider: str
    model_name: str
    model_version: str
    prompt_version: str
    processing_ms: int
    # Statements removed because they cited unknown facts, used numbers not
    # in the facts, or stated a cause.
    dropped_statements: int
