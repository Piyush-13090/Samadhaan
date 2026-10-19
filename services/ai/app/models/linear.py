"""Serving for linear models stored as JSON (Prompt 28).

Two model formats, both fitted by `ml/training.py` with scikit-learn and
exported as plain numbers:

- `tfidf-softmax-v1` — TF-IDF text features (`text_features.py`) into a
  multinomial logistic regression. Problem category, severity and urgency.
- `signals-logistic-v1` — standardised numeric signals into a binary logistic
  regression. Duplicate-pair scoring.

Prediction needs only numpy. The model refuses (abstains) instead of guessing
when its confidence is below the threshold chosen at training time, or when
the input is mostly words it never saw — an out-of-distribution report gets a
human, not a confident label.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.models.tasks import DUPLICATE_SIGNALS
from app.models.text_features import TfidfState, problem_text, transform

TEXT_FORMAT = "tfidf-softmax-v1"
SIGNALS_FORMAT = "signals-logistic-v1"


class ModelFormatError(ValueError):
    """The model document is not a valid instance of its declared format."""


@dataclass(frozen=True)
class Prediction:
    label: str | None
    confidence: float
    probabilities: dict[str, float]
    abstained: bool
    abstain_reason: str | None
    missing_features: list[str] = field(default_factory=list)


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max()
    exp = np.exp(shifted)
    return exp / exp.sum()


def _matrix(value: Any, rows: int, cols: int, name: str) -> np.ndarray:
    try:
        array = np.asarray(value, dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise ModelFormatError(f"{name} is not numeric") from error
    if array.shape != (rows, cols) or not np.all(np.isfinite(array)):
        raise ModelFormatError(f"{name} must be a finite {rows}x{cols} matrix")
    return array


class TextSoftmaxModel:
    def __init__(self, document: dict[str, Any]) -> None:
        if document.get("format") != TEXT_FORMAT:
            raise ModelFormatError("not a tfidf-softmax-v1 model")
        self.labels: list[str] = [str(x) for x in document["labels"]]
        if len(self.labels) < 2 or len(set(self.labels)) != len(self.labels):
            raise ModelFormatError("labels must be at least two distinct values")
        self.features = TfidfState.from_json(document["features"])
        width = len(self.features.vocabulary)
        self.weights = _matrix(document["weights"], len(self.labels), width, "weights")
        self.intercept = _matrix([document["intercept"]], 1, len(self.labels), "intercept")[0]
        decision = document.get("decision", {})
        self.abstain_below = float(decision.get("abstain_below", 0.0))
        self.min_known_ratio = float(decision.get("min_known_ratio", 0.0))
        self.min_tokens = int(decision.get("min_tokens", 1))
        self.uses_category = bool(document.get("uses_category", False))

    def predict(self, inputs: dict[str, Any]) -> Prediction:
        missing = [k for k in ("title", "description") if not (inputs.get(k) or "").strip()]
        if self.uses_category and not inputs.get("category"):
            missing.append("category")
        text = problem_text(
            inputs.get("title"),
            inputs.get("description"),
            inputs.get("category") if self.uses_category else None,
        )
        vector = transform(self.features, text)
        logits = self.intercept.copy()
        if vector.indices:
            logits += self.weights[:, vector.indices] @ np.asarray(vector.values)
        probs = _softmax(logits)
        best = int(np.argmax(probs))
        confidence = float(probs[best])
        probabilities = {
            label: round(float(p), 6) for label, p in zip(self.labels, probs, strict=True)
        }

        reason = None
        if vector.tokens < self.min_tokens:
            reason = "too_little_text"
        elif vector.known_ratio < self.min_known_ratio:
            reason = "out_of_vocabulary"
        elif confidence < self.abstain_below:
            reason = "low_confidence"
        return Prediction(
            label=None if reason else self.labels[best],
            confidence=round(confidence, 6),
            probabilities=probabilities,
            abstained=reason is not None,
            abstain_reason=reason,
            missing_features=missing,
        )


class SignalsLogisticModel:
    def __init__(self, document: dict[str, Any]) -> None:
        if document.get("format") != SIGNALS_FORMAT:
            raise ModelFormatError("not a signals-logistic-v1 model")
        self.signals: list[str] = [str(x) for x in document["signals"]]
        if any(s not in DUPLICATE_SIGNALS for s in self.signals):
            raise ModelFormatError("unknown signal in model")
        width = 2 * len(self.signals)  # each signal plus a "missing" indicator
        self.mean = _matrix([document["mean"]], 1, width, "mean")[0]
        self.scale = _matrix([document["scale"]], 1, width, "scale")[0]
        if np.any(self.scale <= 0):
            raise ModelFormatError("scale must be positive")
        self.coef = _matrix([document["coef"]], 1, width, "coef")[0]
        self.intercept = float(document["intercept"])
        self.threshold = float(document.get("decision", {}).get("threshold", 0.5))
        self.labels = ["NOT_DUPLICATE", "DUPLICATE"]

    def features(self, inputs: dict[str, Any]) -> tuple[np.ndarray, list[str]]:
        values: list[float] = []
        missing_flags: list[float] = []
        missing: list[str] = []
        for name in self.signals:
            raw = inputs.get(name)
            if raw is None:
                missing.append(name)
                values.append(0.0)
                missing_flags.append(1.0)
            else:
                values.append(float(raw))
                missing_flags.append(0.0)
        return np.asarray(values + missing_flags), missing

    def predict(self, inputs: dict[str, Any]) -> Prediction:
        x, missing = self.features(inputs)
        z = float(((x - self.mean) / self.scale) @ self.coef + self.intercept)
        p = 1.0 / (1.0 + math.exp(-z)) if z > -700 else 0.0
        label = "DUPLICATE" if p >= self.threshold else "NOT_DUPLICATE"
        return Prediction(
            label=label,
            confidence=round(p if label == "DUPLICATE" else 1.0 - p, 6),
            probabilities={"NOT_DUPLICATE": round(1.0 - p, 6), "DUPLICATE": round(p, 6)},
            abstained=False,
            abstain_reason=None,
            missing_features=missing,
        )


def build_model(document: dict[str, Any]) -> TextSoftmaxModel | SignalsLogisticModel:
    try:
        if document.get("format") == TEXT_FORMAT:
            return TextSoftmaxModel(document)
        if document.get("format") == SIGNALS_FORMAT:
            return SignalsLogisticModel(document)
    except (KeyError, TypeError) as error:
        raise ModelFormatError(f"model document is incomplete: {error}") from error
    raise ModelFormatError("unknown model format")
