"""Evaluation metrics (Prompt 28).

Computed from actual predictions and actual held-out labels — every function
takes both and returns numbers derived from them, never a constant. Written
in plain Python so each definition is readable next to its docs entry
(docs/ML_EVALUATION.md) and checked against hand-computed examples in
tests/test_ml_metrics.py.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Hashable, Sequence
from typing import Any


def _safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def _r(x: float) -> float:
    return round(x, 6)


# ---------------------------------------------------------------- classification


def classification_report(
    y_true: Sequence[str], y_pred: Sequence[str | None], labels: Sequence[str]
) -> dict[str, Any]:
    """Per-class precision/recall/F1, macro and weighted F1, accuracy, the
    confusion matrix (rows = truth, columns = prediction) and imbalance.

    A `None` prediction is an abstention: it counts against recall (the case
    went to a human) but not against precision, and coverage is reported.
    """
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred differ in length")
    index = {label: i for i, label in enumerate(labels)}
    matrix = [[0] * len(labels) for _ in labels]
    abstained = 0
    for t, p in zip(y_true, y_pred, strict=True):
        if p is None:
            abstained += 1
            continue
        matrix[index[t]][index[p]] += 1
    per_class = {}
    support = Counter(y_true)
    for label in labels:
        i = index[label]
        tp = matrix[i][i]
        predicted = sum(row[i] for row in matrix)
        precision = _safe_div(tp, predicted)
        recall = _safe_div(tp, support[label])
        f1 = _safe_div(2 * precision * recall, precision + recall)
        per_class[label] = {
            "precision": _r(precision),
            "recall": _r(recall),
            "f1": _r(f1),
            "support": support[label],
        }
    present = [label for label in labels if support[label] > 0]
    macro_f1 = _safe_div(sum(per_class[label]["f1"] for label in present), len(present))
    weighted_f1 = _safe_div(
        sum(per_class[label]["f1"] * support[label] for label in present), len(y_true)
    )
    correct = sum(matrix[i][i] for i in range(len(labels)))
    counts = [support[label] for label in present]
    return {
        "n": len(y_true),
        "accuracy": _r(_safe_div(correct, len(y_true))),
        "macroF1": _r(macro_f1),
        "weightedF1": _r(weighted_f1),
        "coverage": _r(_safe_div(len(y_true) - abstained, len(y_true))),
        "abstained": abstained,
        "perClass": per_class,
        "labels": list(labels),
        "confusionMatrix": matrix,
        "imbalance": {
            "classesPresent": len(present),
            "classesAbsent": [label for label in labels if support[label] == 0],
            "maxToMinRatio": _r(_safe_div(max(counts), min(counts))) if counts else None,
        },
    }


def ordinal_report(
    y_true: Sequence[str], y_pred: Sequence[str | None], order: Sequence[str]
) -> dict[str, Any]:
    """Classification metrics plus ordinal-aware ones, over non-abstained cases:
    mean absolute error in levels, within-one-level accuracy, quadratic weighted
    kappa, and under-prediction of the most severe level (the costly error)."""
    base = classification_report(y_true, y_pred, order)
    rank = {label: i for i, label in enumerate(order)}
    pairs = [(rank[t], rank[p]) for t, p in zip(y_true, y_pred, strict=True) if p is not None]
    k = len(order)
    if pairs:
        mae = sum(abs(t - p) for t, p in pairs) / len(pairs)
        within_one = sum(abs(t - p) <= 1 for t, p in pairs) / len(pairs)
        observed = [[0] * k for _ in range(k)]
        for t, p in pairs:
            observed[t][p] += 1
        n = len(pairs)
        row = [sum(observed[i]) for i in range(k)]
        col = [sum(observed[i][j] for i in range(k)) for j in range(k)]
        num = den = 0.0
        for i in range(k):
            for j in range(k):
                w = ((i - j) ** 2) / ((k - 1) ** 2)
                num += w * observed[i][j]
                den += w * row[i] * col[j] / n
        qwk = 1 - _safe_div(num, den) if den else 0.0
    else:
        mae = within_one = qwk = 0.0
    top = order[-1]
    top_true = [p for t, p in zip(y_true, y_pred, strict=True) if t == top]
    under = sum(1 for p in top_true if p is None or rank[p] < rank[top])
    return {
        **base,
        "meanAbsoluteError": _r(mae),
        "withinOneLevel": _r(within_one),
        "quadraticWeightedKappa": _r(qwk),
        "mostSevere": {
            "label": top,
            "support": len(top_true),
            "underPredictedOrAbstained": under,
            "recall": base["perClass"][top]["recall"],
        },
    }


# ---------------------------------------------------------------- binary scores


def average_precision(y_true: Sequence[bool], scores: Sequence[float]) -> float:
    """Area under the precision-recall curve, step-wise (as scikit-learn)."""
    positives = sum(y_true)
    if positives == 0:
        return 0.0
    ranked = sorted(zip(scores, y_true, strict=True), key=lambda x: -x[0])
    ap = tp = fp = 0
    prev_recall = 0.0
    i = 0
    while i < len(ranked):
        j = i
        while j < len(ranked) and ranked[j][0] == ranked[i][0]:
            tp += ranked[j][1]
            fp += not ranked[j][1]
            j += 1
        recall = tp / positives
        precision = tp / (tp + fp)
        ap += (recall - prev_recall) * precision
        prev_recall = recall
        i = j
    return ap


def binary_report(
    y_true: Sequence[bool],
    scores: Sequence[float],
    threshold: float,
    ids: Sequence[str] | None = None,
    max_examples: int = 20,
) -> dict[str, Any]:
    """Precision/recall/F1 at a threshold, average precision, a down-sampled PR
    curve, and the ids of false positives and false negatives for review."""
    pred = [s >= threshold for s in scores]
    tp = sum(t and p for t, p in zip(y_true, pred, strict=True))
    fp = sum((not t) and p for t, p in zip(y_true, pred, strict=True))
    fn = sum(t and (not p) for t, p in zip(y_true, pred, strict=True))
    tn = len(pred) - tp - fp - fn
    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    curve = []
    for th in sorted(set(round(s, 4) for s in scores)):
        p = [s >= th for s in scores]
        ctp = sum(t and q for t, q in zip(y_true, p, strict=True))
        cfp = sum((not t) and q for t, q in zip(y_true, p, strict=True))
        curve.append(
            {
                "threshold": th,
                "precision": _r(_safe_div(ctp, ctp + cfp)),
                "recall": _r(_safe_div(ctp, sum(y_true))),
            }
        )
    if len(curve) > 101:
        step = len(curve) / 100
        curve = [curve[int(i * step)] for i in range(100)] + [curve[-1]]
    ids = list(ids) if ids is not None else [str(i) for i in range(len(pred))]
    rows = list(zip(ids, y_true, pred, strict=True))
    return {
        "n": len(pred),
        "threshold": threshold,
        "precision": _r(precision),
        "recall": _r(recall),
        "f1": _r(_safe_div(2 * precision * recall, precision + recall)),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "averagePrecision": _r(average_precision(y_true, scores)),
        "prCurve": curve,
        "falsePositives": [i for i, t, p in rows if p and not t][:max_examples],
        "falseNegatives": [i for i, t, p in rows if t and not p][:max_examples],
    }


# ---------------------------------------------------------------- ranking


def _dcg(relevances: Sequence[float]) -> float:
    return sum((2**rel - 1) / math.log2(i + 2) for i, rel in enumerate(relevances))


def ranking_report(
    judgements: Sequence[tuple[Hashable, Hashable, float, float]],
    ks: Sequence[int] = (1, 3, 5, 10),
    relevant_at: float = 1,
) -> dict[str, Any]:
    """Mean precision@K, recall@K, MRR and NDCG@K over queries.

    `judgements` are (query_id, item_id, relevance, system_score); the system's
    ranking is by score, descending, ties broken by item id. Queries with no
    relevant item are excluded from recall and MRR (undefined) and counted.
    """
    by_query: dict[Hashable, list[tuple[float, float, str]]] = defaultdict(list)
    for query, item, relevance, score in judgements:
        by_query[query].append((score, relevance, str(item)))
    out: dict[str, Any] = {"queries": len(by_query), "withoutRelevant": 0}
    sums: dict[str, float] = defaultdict(float)
    counted = 0
    for items in by_query.values():
        ranked = [rel for _, rel, _ in sorted(items, key=lambda x: (-x[0], x[2]))]
        relevant = [rel >= relevant_at for rel in ranked]
        total_relevant = sum(relevant)
        if total_relevant == 0:
            out["withoutRelevant"] += 1
            continue
        counted += 1
        first = next(i for i, r in enumerate(relevant) if r)
        sums["mrr"] += 1 / (first + 1)
        ideal = sorted(ranked, reverse=True)
        for k in ks:
            sums[f"precision@{k}"] += sum(relevant[:k]) / k
            sums[f"recall@{k}"] += sum(relevant[:k]) / total_relevant
            sums[f"ndcg@{k}"] += _safe_div(_dcg(ranked[:k]), _dcg(ideal[:k]))
    for key, value in sorted(sums.items()):
        out[key] = _r(_safe_div(value, counted))
    out["evaluatedQueries"] = counted
    return out


# ---------------------------------------------------------------- verification


def verification_report(y_true: Sequence[str], y_pred: Sequence[str]) -> dict[str, Any]:
    """Outcome classes RESOLVED / NOT_RESOLVED / INSUFFICIENT_EVIDENCE.

    The costly error is claiming resolution that did not happen, so the false
    resolution rate — P(predicted RESOLVED | truly not RESOLVED) — is reported
    on its own, and the insufficient-evidence class is evaluated separately.
    """
    labels = ["RESOLVED", "NOT_RESOLVED", "INSUFFICIENT_EVIDENCE"]
    base = classification_report(y_true, y_pred, labels)
    not_resolved = [p for t, p in zip(y_true, y_pred, strict=True) if t != "RESOLVED"]
    false_resolved = sum(1 for p in not_resolved if p == "RESOLVED")
    return {
        **base,
        "falseResolution": {
            "count": false_resolved,
            "outOf": len(not_resolved),
            "rate": _r(_safe_div(false_resolved, len(not_resolved))),
        },
        "insufficientEvidence": base["perClass"]["INSUFFICIENT_EVIDENCE"],
    }


#: How the existing system's advisory recommendation maps onto outcomes for
#: baseline evaluation. POSSIBLY_RESOLVED is not a resolution claim.
RECOMMENDATION_AS_OUTCOME = {
    "LIKELY_RESOLVED": "RESOLVED",
    "POSSIBLY_RESOLVED": "INSUFFICIENT_EVIDENCE",
    "LIKELY_NOT_RESOLVED": "NOT_RESOLVED",
    "INSUFFICIENT_EVIDENCE": "INSUFFICIENT_EVIDENCE",
}


# ---------------------------------------------------------------- correlation


def spearman(x: Sequence[float], y: Sequence[float]) -> float:
    """Spearman rank correlation with average ranks for ties."""

    def ranks(values: Sequence[float]) -> list[float]:
        order = sorted(range(len(values)), key=lambda i: values[i])
        out = [0.0] * len(values)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
                j += 1
            for k in range(i, j + 1):
                out[order[k]] = (i + j) / 2
            i = j + 1
        return out

    rx, ry = ranks(x), ranks(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry, strict=True))
    sx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    sy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return _safe_div(cov, sx * sy)


# ---------------------------------------------------------------- groups


def slice_report(
    groups: Sequence[str | None],
    y_true: Sequence[str],
    y_pred: Sequence[str | None],
    labels: Sequence[str],
    min_group_size: int = 30,
) -> dict[str, Any]:
    """Macro-F1 and accuracy per group (e.g. city or category), with groups
    smaller than `min_group_size` suppressed — neither named nor scored —
    because small groups are statistically unreliable and can identify people."""
    members: dict[str, list[int]] = defaultdict(list)
    for i, group in enumerate(groups):
        members[group or "(unknown)"].append(i)
    reported: dict[str, Any] = {}
    suppressed = 0
    for group in sorted(members):
        idx = members[group]
        if len(idx) < min_group_size:
            suppressed += 1
            continue
        r = classification_report([y_true[i] for i in idx], [y_pred[i] for i in idx], labels)
        reported[group] = {"n": len(idx), "macroF1": r["macroF1"], "accuracy": r["accuracy"]}
    return {"minGroupSize": min_group_size, "groups": reported, "suppressedGroups": suppressed}
