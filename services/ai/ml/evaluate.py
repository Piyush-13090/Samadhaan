"""Baseline evaluation without training (Prompt 28).

    python -m ml evaluate --dataset <dir> [--split test] [--k 1,3,5]

Scores the *existing* system's outputs, carried in the dataset's baseline
columns, against the dataset's human labels — the measurement every task needs
before anyone trains a replacement. Works for tasks that are evaluation-only
today (organisation matching, retrieval, verification, priority) as well as
the trainable ones.

By default the whole dataset is evaluated, because no tuning happens here. If
the same dataset will later train a model, pass `--split test` to evaluate only
the held-out test split, so baseline and model are compared on the same rows.
"""

from __future__ import annotations

from typing import Any

from app.core.taxonomy import CATEGORIES, SEVERITIES, URGENCIES
from ml.dataset import Dataset
from ml.metrics import (
    RECOMMENDATION_AS_OUTCOME,
    binary_report,
    classification_report,
    ordinal_report,
    ranking_report,
    spearman,
    verification_report,
)

TIER_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class EvaluationError(Exception):
    pass


def _require(records: list[dict[str, Any]], column: str) -> list[dict[str, Any]]:
    present = [r for r in records if r.get(column) is not None]
    if not present:
        raise EvaluationError(f"no record carries {column}; nothing to evaluate")
    return present


def evaluate_records(
    dataset: Dataset,
    records: list[dict[str, Any]],
    *,
    ks: tuple[int, ...] = (1, 3, 5, 10),
    duplicate_threshold: float = 0.65,
) -> dict[str, Any]:
    task = dataset.task
    if "evaluation" not in dataset.manifest.permitted_uses:
        raise EvaluationError("dataset manifest does not permit evaluation")
    out: dict[str, Any] = {
        "task": task,
        "dataset": {
            "name": dataset.manifest.name,
            "version": dataset.manifest.version,
            "fingerprint": dataset.fingerprint,
            "synthetic": dataset.manifest.synthetic,
        },
        "records": len(records),
    }

    if task == "problem_category":
        rows = _require(records, "baseline_category")
        out["existingSystem"] = classification_report(
            [r["category"] for r in rows], [r["baseline_category"] for r in rows], CATEGORIES
        )
    elif task in {"problem_severity", "problem_urgency"}:
        label = task.split("_")[1]
        rows = _require(records, f"baseline_{label}")
        order = SEVERITIES if label == "severity" else URGENCIES
        out["existingSystem"] = ordinal_report(
            [r[label] for r in rows], [r[f"baseline_{label}"] for r in rows], order
        )
    elif task == "duplicate_pair":
        rows = _require(records, "baseline_score")
        out["existingSystem"] = binary_report(
            [bool(r["is_duplicate"]) for r in rows],
            [float(r["baseline_score"]) for r in rows],
            duplicate_threshold,
            [r["record_id"] for r in rows],
        )
    elif task in {"organization_relevance", "retrieval_judgement"}:
        item = "organization_id" if task == "organization_relevance" else "document_id"
        rows = _require(records, "system_score")
        judgements = [
            (r["query_id"], r[item], float(r["relevance"]), float(r["system_score"])) for r in rows
        ]
        out["existingSystem"] = ranking_report(judgements, ks)
        if task == "organization_relevance":
            out["exposureBySize"] = _exposure_by_size(rows)
    elif task == "verification_outcome":
        rows = _require(records, "system_recommendation")
        out["existingSystem"] = verification_report(
            [r["outcome"] for r in rows],
            [RECOMMENDATION_AS_OUTCOME[r["system_recommendation"]] for r in rows],
        )
    elif task == "priority_judgement":
        rows = _require(records, "engine_score")
        expert = [TIER_ORDER.index(r["expert_tier"]) for r in rows]
        out["existingSystem"] = {
            "n": len(rows),
            "spearmanWithExpertTier": round(spearman([r["engine_score"] for r in rows], expert), 6),
            "ranking": ranking_report(
                [
                    (
                        "all",
                        r["problem_id"],
                        float(TIER_ORDER.index(r["expert_tier"])),
                        r["engine_score"],
                    )
                    for r in rows
                ],
                ks,
                relevant_at=2,  # HIGH or CRITICAL
            ),
        }
    else:  # pragma: no cover - schemas restrict tasks
        raise EvaluationError(f"no evaluation defined for {task}")
    out["coverage"] = round(len(rows) / len(records), 6) if records else 0.0
    return out


def _exposure_by_size(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Share of top-3 recommendation slots each organisation size receives, next
    to its share of relevant (relevance ≥ 2) judgements. A large gap toward big
    organisations is the bias docs/ML_EVALUATION.md asks to watch for."""
    by_query: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_query.setdefault(r["query_id"], []).append(r)
    top: dict[str, int] = {}
    relevant: dict[str, int] = {}
    for items in by_query.values():
        ranked = sorted(items, key=lambda r: (-float(r["system_score"]), r["organization_id"]))
        for r in ranked[:3]:
            size = r.get("organization_size") or "UNKNOWN"
            top[size] = top.get(size, 0) + 1
        for r in items:
            if r["relevance"] >= 2:
                size = r.get("organization_size") or "UNKNOWN"
                relevant[size] = relevant.get(size, 0) + 1
    total_top, total_rel = sum(top.values()), sum(relevant.values())
    sizes = sorted(set(top) | set(relevant))
    return {
        size: {
            "topSlotShare": round(top.get(size, 0) / total_top, 6) if total_top else 0.0,
            "relevantShare": round(relevant.get(size, 0) / total_rel, 6) if total_rel else 0.0,
        }
        for size in sizes
    }
