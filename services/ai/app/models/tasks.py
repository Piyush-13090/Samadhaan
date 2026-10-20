"""Trainable tasks and their schema versions (Prompt 28).

The single list of what a locally trained model may do in this service. A task
is here only when there is a defined input schema, a defined label schema and a
path to human-reviewed labels for it — see docs/ML_CAPABILITY_INVENTORY.md.
The NestJS registry mirrors this table (`apps/api/src/ml/ml-tasks.ts`); an
artifact whose schema versions do not match is refused at verification time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from app.core.taxonomy import CATEGORIES, SEVERITIES, URGENCIES

TaskKind = Literal["text_classification", "ordinal_text_classification", "binary_signals"]


@dataclass(frozen=True)
class TaskSpec:
    name: str
    kind: TaskKind
    feature_schema: str
    label_schema: str
    labels: tuple[str, ...]


TASKS: Final[dict[str, TaskSpec]] = {
    "problem_category": TaskSpec(
        name="problem_category",
        kind="text_classification",
        feature_schema="problem-text-v1",
        label_schema="problem-category-v1",
        labels=CATEGORIES,
    ),
    "problem_severity": TaskSpec(
        name="problem_severity",
        kind="ordinal_text_classification",
        feature_schema="problem-text-category-v1",
        label_schema="problem-severity-v1",
        labels=SEVERITIES,
    ),
    "problem_urgency": TaskSpec(
        name="problem_urgency",
        kind="ordinal_text_classification",
        feature_schema="problem-text-category-v1",
        label_schema="problem-urgency-v1",
        labels=URGENCIES,
    ),
    "duplicate_pair": TaskSpec(
        name="duplicate_pair",
        kind="binary_signals",
        feature_schema="duplicate-signals-v1",
        label_schema="duplicate-pair-v1",
        labels=("NOT_DUPLICATE", "DUPLICATE"),
    ),
}

#: Signals of a candidate pair, in model order. The same 0–1 signals
#: `problem_duplicate_candidates` stores; image similarity is optional because
#: no image-embedding model exists yet (docs/ML_PLAN.md §6).
DUPLICATE_SIGNALS: Final[tuple[str, ...]] = (
    "text_similarity",
    "geographic_similarity",
    "category_similarity",
    "image_similarity",
)
