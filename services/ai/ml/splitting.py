"""Leakage-aware, deterministic dataset splits (Prompt 28).

Records are first grouped so that anything describing the same civic incident
lands in the same split:

- records sharing an `incident_id`;
- records with identical normalised text (near-verbatim resubmissions);
- for duplicate pairs, every problem connected through any pair (union-find),
  so an incident never appears on both sides of an evaluation.

Groups — never individual records — are then assigned by one of:

- `group_random`: a keyed hash of (seed, group key). Deterministic and stable:
  adding records does not reshuffle existing groups.
- `time`: groups ordered by their earliest `created_at`; oldest train, newest
  test. For future-facing predictions (severity, urgency, priority).
- `geographic`: groups whose city is in `holdout_cities` form the test set; the
  rest are split `group_random` into train and validation.

The test split is for the final evaluation only; training code never reads it
during model or threshold selection.
"""

from __future__ import annotations

import hashlib
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Literal

from ml.dataset import Dataset

Strategy = Literal["group_random", "time", "geographic"]
SPLITS = ("train", "validation", "test")


class InsufficientDataError(Exception):
    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


@dataclass(frozen=True)
class SplitConfig:
    strategy: Strategy = "group_random"
    seed: int = 20261018
    validation: float = 0.15
    test: float = 0.15
    holdout_cities: tuple[str, ...] = ()
    min_test_records: int = 30
    min_test_per_class: int = 3
    min_train_per_class: int = 5

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> SplitConfig:
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        if "holdout_cities" in known:
            known["holdout_cities"] = tuple(known["holdout_cities"])
        return cls(**known)


@dataclass
class Split:
    train: list[dict[str, Any]]
    validation: list[dict[str, Any]]
    test: list[dict[str, Any]]
    report: dict[str, Any] = field(default_factory=dict)

    def part(self, name: str) -> list[dict[str, Any]]:
        return getattr(self, name)


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # Smallest id wins, so the root (and therefore the group key) is
            # independent of record order.
            low, high = sorted((ra, rb))
            self.parent[high] = low


def group_records(dataset: Dataset) -> dict[str, list[dict[str, Any]]]:
    uf = _UnionFind()
    for record in dataset.records:
        rid = f"r:{record['record_id']}"
        uf.find(rid)
        if record.get("incident_id"):
            uf.union(rid, f"i:{record['incident_id']}")
        if "title" in record:
            text = f"{record['title'].lower()}\n{record['description'].lower()}"
            uf.union(rid, "t:" + hashlib.sha256(text.encode()).hexdigest())
        if dataset.task == "duplicate_pair":
            uf.union(rid, f"p:{record['problem_a']}")
            uf.union(rid, f"p:{record['problem_b']}")
        for key in ("query_id", "project_id", "problem_id"):
            if record.get(key):
                # Ranking judgements for one query, or evidence of one project,
                # stay together.
                uf.union(rid, f"{key}:{record[key]}")
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in dataset.records:
        groups[uf.find(f"r:{record['record_id']}")].append(record)
    return dict(groups)


def _unit(seed: int, key: str) -> float:
    digest = hashlib.sha256(f"{seed}:{key}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def split_dataset(dataset: Dataset, config: SplitConfig, *, check_classes: bool = True) -> Split:
    groups = group_records(dataset)
    assignment: dict[str, str] = {}
    keys = sorted(groups)

    if config.strategy == "time":

        def first_seen(key: str) -> str:
            stamps = [r.get("created_at") for r in groups[key] if r.get("created_at")]
            if not stamps:
                raise InsufficientDataError(["time split needs created_at on every record"])
            return min(stamps)

        ordered = sorted(keys, key=lambda k: (first_seen(k), k))
        n = len(ordered)
        test_start = n - round(n * config.test)
        val_start = test_start - round(n * config.validation)
        for i, key in enumerate(ordered):
            assignment[key] = (
                "train" if i < val_start else "validation" if i < test_start else "test"
            )
    else:
        holdout = {c.lower() for c in config.holdout_cities}
        if config.strategy == "geographic" and not holdout:
            raise InsufficientDataError(["geographic split needs holdout_cities"])
        for key in keys:
            cities = {(r.get("city") or "").lower() for r in groups[key]}
            if config.strategy == "geographic" and cities & holdout:
                assignment[key] = "test"
                continue
            u = _unit(config.seed, key)
            if config.strategy == "geographic":
                share = config.validation / (1 - config.test)
                assignment[key] = "validation" if u < share else "train"
            else:
                assignment[key] = (
                    "test"
                    if u < config.test
                    else "validation"
                    if u < config.test + config.validation
                    else "train"
                )

    parts: dict[str, list[dict[str, Any]]] = {s: [] for s in SPLITS}
    for key in keys:
        parts[assignment[key]].extend(groups[key])
    for name in SPLITS:
        parts[name].sort(key=lambda r: r["record_id"])

    label = dataset.label_field
    counts = {s: dict(sorted(Counter(str(r[label]) for r in parts[s]).items())) for s in SPLITS}
    report = {
        "strategy": config.strategy,
        "seed": config.seed,
        "ratios": {"validation": config.validation, "test": config.test},
        "holdoutCities": list(config.holdout_cities),
        "groups": len(keys),
        "records": {s: len(parts[s]) for s in SPLITS},
        "groupsPerSplit": {s: sum(1 for k in keys if assignment[k] == s) for s in SPLITS},
        "labelsPerSplit": counts,
    }

    problems: list[str] = []
    if len(parts["test"]) < config.min_test_records:
        problems.append(
            f"test split has {len(parts['test'])} records; "
            f"at least {config.min_test_records} needed"
        )
    if check_classes:
        for value in sorted(set(counts["train"]) | set(counts["test"])):
            if counts["train"].get(value, 0) < config.min_train_per_class:
                problems.append(
                    f"label {value}: {counts['train'].get(value, 0)} training records "
                    f"(minimum {config.min_train_per_class})"
                )
            if counts["test"].get(value, 0) < config.min_test_per_class:
                problems.append(
                    f"label {value}: {counts['test'].get(value, 0)} test records "
                    f"(minimum {config.min_test_per_class})"
                )
    if problems:
        raise InsufficientDataError(problems)
    return Split(parts["train"], parts["validation"], parts["test"], report)
