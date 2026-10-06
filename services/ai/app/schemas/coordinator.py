"""AI Project Coordinator contracts (Prompt 19).

Three layers, each stricter than the last:

* ``CoordinatorRequest`` — the structured context NestJS built from the
  database. Every item carries a ``ref`` (``task:<id>``, ``message:<id>``, …).
* ``CoordinatorModelOutput`` — what the model is constrained to return.
* ``CoordinatorResult`` — the model output after validation: every finding
  cites refs that exist in the request, health is never below the
  deterministic baseline, and nothing is longer than it should be.

The model never sees database ids it could act on, and nothing here can change
project state — this service returns advice; NestJS persists it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Health = Literal["HEALTHY", "NEEDS_ATTENTION", "AT_RISK", "BLOCKED"]
HEALTH_ORDER: dict[str, int] = {"HEALTHY": 0, "NEEDS_ATTENTION": 1, "AT_RISK": 2, "BLOCKED": 3}

RiskType = Literal[
    "OVERDUE_TASK",
    "BLOCKED_TASK",
    "UPCOMING_DEADLINE",
    "MISSING_UPDATE",
    "MILESTONE_DELAY",
    "INSUFFICIENT_PROGRESS",
    "REPEATED_BLOCKER",
    "OTHER",
]
RiskSeverity = Literal["LOW", "MEDIUM", "HIGH"]
QuestionCategory = Literal[
    "TASK_PROGRESS",
    "BLOCKER",
    "DEADLINE",
    "MILESTONE",
    "MISSING_UPDATE",
    "GENERAL",
]

# Bounds. Generous enough for real projects, tight enough that a runaway model
# cannot produce a wall of text.
MAX_TEXT = 600
MAX_ITEMS = 8


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- context


class ContextProblem(_Strict):
    public_id: str
    title: str
    description: str = Field(max_length=1500)
    category: str
    subcategory: str | None = None
    severity: str | None = None
    urgency: str | None = None
    area: str | None = None
    ai_summary: str | None = None


class ContextProject(_Strict):
    name: str
    status: str
    start_date: str | None = None
    target_date: str | None = None
    task_progress: int = Field(ge=0, le=100)
    open_tasks: int = Field(ge=0)
    completed_tasks: int = Field(ge=0)
    cancelled_tasks: int = Field(ge=0)


class ContextTask(_Strict):
    ref: str
    title: str
    status: str
    priority: str
    assignee: str | None = None
    due_date: str | None = None
    overdue: bool = False
    days_overdue: int | None = None
    milestone_ref: str | None = None
    days_since_update: int | None = None


class ContextMilestone(_Strict):
    ref: str
    title: str
    status: str
    due_date: str | None = None
    open_tasks: int = 0
    completed_tasks: int = 0


class ContextEvent(_Strict):
    ref: str
    kind: str
    subject: str | None = None
    detail: str | None = None
    days_ago: int


class ContextMessage(_Strict):
    ref: str
    side: Literal["GOVERNMENT", "ORGANIZATION"]
    author: str
    days_ago: int
    text: str = Field(max_length=800)


class ContextUpdate(_Strict):
    ref: str
    days_ago: int
    summary: str
    completed: list[str] = Field(default_factory=list)
    current: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)


class ContextQuestion(_Strict):
    ref: str
    question: str
    answer: str | None = None
    days_ago: int


class ContextSignal(_Strict):
    """A deterministic finding NestJS computed from the data."""

    ref: str
    code: str
    severity: RiskSeverity
    title: str
    source_ref: str | None = None


class ContextKnowledge(_Strict):
    """A retrieved knowledge passage (Prompt 20). Untrusted reference material."""

    ref: str
    title: str = Field(max_length=300)
    section: str | None = None
    excerpt: str = Field(max_length=1500)


class BaselineHealth(_Strict):
    health: Health
    reasons: list[str]


class CoordinatorRequest(_Strict):
    project_id: str
    today: str
    problem: ContextProblem
    project: ContextProject
    tasks: list[ContextTask] = Field(default_factory=list, max_length=200)
    milestones: list[ContextMilestone] = Field(default_factory=list, max_length=100)
    events: list[ContextEvent] = Field(default_factory=list, max_length=100)
    messages: list[ContextMessage] = Field(default_factory=list, max_length=100)
    updates: list[ContextUpdate] = Field(default_factory=list, max_length=50)
    answered_questions: list[ContextQuestion] = Field(default_factory=list, max_length=50)
    open_questions: list[ContextQuestion] = Field(default_factory=list, max_length=50)
    signals: list[ContextSignal] = Field(default_factory=list, max_length=200)
    knowledge: list[ContextKnowledge] = Field(default_factory=list, max_length=10)
    baseline: BaselineHealth

    def refs(self) -> set[str]:
        """Every reference a finding may cite."""
        found: set[str] = set()
        for group in (
            self.tasks,
            self.milestones,
            self.events,
            self.messages,
            self.updates,
            self.answered_questions,
            self.signals,
            self.knowledge,
        ):
            found.update(item.ref for item in group)
        return found


# ------------------------------------------------------------ model output


class ModelRisk(_Strict):
    type: RiskType
    severity: RiskSeverity
    title: str = Field(max_length=160)
    description: str = Field(max_length=MAX_TEXT)
    source_refs: list[str] = Field(max_length=6)


class ModelBlocker(_Strict):
    """A potential blocker the model noticed — usually in a message."""

    title: str = Field(max_length=160)
    description: str = Field(max_length=MAX_TEXT)
    source_refs: list[str] = Field(max_length=6)


class ModelSuggestion(_Strict):
    text: str = Field(max_length=MAX_TEXT)
    source_refs: list[str] = Field(max_length=6)


class ModelQuestion(_Strict):
    question: str = Field(max_length=400)
    category: QuestionCategory
    # The one task/milestone the question is about, when there is one.
    target_ref: str | None = None
    source_refs: list[str] = Field(max_length=6)


class CoordinatorModelOutput(_Strict):
    """What the model must return. No reasoning field: conclusions only."""

    summary: str = Field(max_length=1200)
    health: Health
    health_reason: str = Field(max_length=MAX_TEXT)
    risks: list[ModelRisk] = Field(default_factory=list, max_length=MAX_ITEMS)
    potential_blockers: list[ModelBlocker] = Field(default_factory=list, max_length=5)
    suggestions: list[ModelSuggestion] = Field(default_factory=list, max_length=5)
    questions: list[ModelQuestion] = Field(default_factory=list, max_length=4)


# ------------------------------------------------------------------ result


class CoordinatorResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    summary: str
    health: Health
    health_reason: str
    risks: list[ModelRisk]
    potential_blockers: list[ModelBlocker]
    suggestions: list[ModelSuggestion]
    questions: list[ModelQuestion]
    provider: str
    model_name: str
    model_version: str
    prompt_version: str
    processing_ms: int
    # Findings removed because they cited nothing real. Recorded, so a model
    # that hallucinates references shows up in the data.
    dropped_items: int


# ------------------------------------------------------- update extraction


class ExtractUpdateRequest(_Strict):
    text: str = Field(min_length=1, max_length=6000)
    project_name: str | None = None


class ExtractedUpdate(_Strict):
    """A structured update suggested from free text. A person confirms it."""

    summary: str = Field(max_length=400)
    completed: list[str] = Field(default_factory=list, max_length=8)
    current: list[str] = Field(default_factory=list, max_length=8)
    blockers: list[str] = Field(default_factory=list, max_length=8)
    next_steps: list[str] = Field(default_factory=list, max_length=8)


class ExtractUpdateResult(ExtractedUpdate):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    provider: str
    model_name: str
    model_version: str
    prompt_version: str
    # Items dropped because they did not appear in the source text.
    dropped_items: int
