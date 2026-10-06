"""Matching engines.

`MatchingEngine` is the contract; `HeuristicMatchingEngine` is today's only
implementation. A trained model (learning-to-rank on outcome data, once
allocation and resolution produce some) replaces it by implementing the same
`score` method — the API, the persistence and the UI do not change.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.matching import features
from app.schemas.matching import MatchCandidate, MatchProblem, MatchReason, MatchSignals

#: An area of work is listed as a reason only when it alone is a solid match —
#: a family-level relation at a declared level (0.6 × 0.85) is not.
MATCHED_EXPERTISE_MIN = 0.6

SIGNALS = ("semantic", "expertise", "category", "geographic", "capability", "activity")


@dataclass(frozen=True)
class TextSignals:
    """Phrase-level similarities the service computed with the encoder.

    `expertise[i][j]` is the rescaled similarity between the problem and
    candidate i's expertise entry j. `capability[i]` is the problem against
    candidate i's type description. Absent when the encoder was unavailable.
    """

    expertise: list[list[float]] | None = None
    capability: list[float] | None = None


@dataclass
class ScoredCandidate:
    candidate: MatchCandidate
    signals: MatchSignals
    final_score: float
    reasons: list[MatchReason]
    matched_expertise: list[int] = field(default_factory=list)


class MatchingEngine(ABC):
    """Scores candidate organisations for one problem."""

    name: str
    version: str
    trained: bool

    @property
    @abstractmethod
    def weights(self) -> dict[str, float]:
        """The weight given to each signal, for provenance."""

    @property
    def matching_version(self) -> str:
        """Engine identity plus a hash of its rules, so changing a weight or a
        threshold produces a new version rather than silently different rows."""
        fingerprint = json.dumps(
            {"weights": self.weights, "params": self.parameters()}, sort_keys=True
        )
        digest = hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()[:7]
        return f"{self.name}@{self.version}+{digest}"

    def parameters(self) -> dict[str, float]:
        """Thresholds and constants that affect scores."""
        return {}

    @abstractmethod
    def score(
        self,
        problem: MatchProblem,
        candidates: list[MatchCandidate],
        text: TextSignals,
    ) -> list[ScoredCandidate]:
        """Scores every candidate. Order is not significant; ranking is separate."""


class HeuristicMatchingEngine(MatchingEngine):
    """The initial baseline: real signals, hand-chosen weights.

    Signals are computed from embeddings, the taxonomy, PostGIS distance and
    the organisation's declared expertise. They are combined by a weighted
    average whose weights are a design statement — relevance first, geography
    and history weak — **not** the output of training. When a signal is
    unavailable its weight is redistributed over the others rather than being
    scored as zero, so a missing input never reads as a bad match.
    """

    name = "heuristic-baseline"
    version = "1.0.0"
    trained = False

    def __init__(self, weights: dict[str, float]) -> None:
        unknown = set(weights) - set(SIGNALS)
        if unknown:
            raise ValueError(f"unknown signals: {sorted(unknown)}")
        if any(value < 0 for value in weights.values()):
            raise ValueError("weights must be non-negative")
        if sum(weights.values()) <= 0:
            raise ValueError("at least one weight must be positive")
        self._weights = {signal: float(weights.get(signal, 0.0)) for signal in SIGNALS}

    @property
    def weights(self) -> dict[str, float]:
        return dict(self._weights)

    def parameters(self) -> dict[str, float]:
        return {
            "same_family": features.SAME_FAMILY,
            "ai_category_discount": features.AI_CATEGORY_DISCOUNT,
            "semantic_floor": features.SEMANTIC_FLOOR,
            "semantic_ceiling": features.SEMANTIC_CEILING,
            "phrase_floor": features.PHRASE_FLOOR,
            "phrase_ceiling": features.PHRASE_CEILING,
            "geo_scale_m": features.GEOGRAPHIC_SCALE_METERS,
            "same_city": features.SAME_CITY_SCORE,
            "unknown_location": features.UNKNOWN_LOCATION_SCORE,
            "activity_baseline": features.ACTIVITY_BASELINE,
            "matched_expertise_min": MATCHED_EXPERTISE_MIN,
        }

    def score(
        self,
        problem: MatchProblem,
        candidates: list[MatchCandidate],
        text: TextSignals,
    ) -> list[ScoredCandidate]:
        return [
            self._score_one(problem, candidate, index, text)
            for index, candidate in enumerate(candidates)
        ]

    def _score_one(
        self,
        problem: MatchProblem,
        candidate: MatchCandidate,
        index: int,
        text: TextSignals,
    ) -> ScoredCandidate:
        # Category compatibility per expertise entry, from the taxonomy.
        compat = [
            features.problem_category_compatibility(
                problem.category, problem.ai_category, entry.category
            )
            for entry in candidate.expertise
        ]
        phrase = text.expertise[index] if text.expertise is not None else None

        # Expertise: the best declared area, weighted by its level. An area is
        # relevant if the taxonomy says so *or* its wording is semantically
        # close to the problem — "flood mapping" can match a waterlogging
        # report even when the categories differ.
        per_entry: list[float] = []
        for j, entry in enumerate(candidate.expertise):
            relevance = compat[j]
            if phrase is not None and j < len(phrase):
                relevance = max(relevance, phrase[j])
            per_entry.append(features.LEVEL_WEIGHT[entry.level] * relevance)

        expertise = max(per_entry) if per_entry else 0.0
        category = max(compat) if compat else 0.0
        matched = sorted(
            (j for j, value in enumerate(per_entry) if value >= MATCHED_EXPERTISE_MIN),
            key=lambda j: per_entry[j],
            reverse=True,
        )

        signals = MatchSignals(
            semantic=features.rescale(
                candidate.semantic_similarity,
                features.SEMANTIC_FLOOR,
                features.SEMANTIC_CEILING,
            ),
            expertise=expertise,
            category=category,
            geographic=features.geographic_relevance(
                candidate.distance_meters, candidate.same_city, candidate.has_location
            ),
            capability=text.capability[index] if text.capability is not None else None,
            activity=features.activity_score(candidate.relevant_activity_count),
        )

        return ScoredCandidate(
            candidate=candidate,
            signals=signals,
            final_score=self._combine(signals),
            reasons=self._reasons(candidate, signals),
            matched_expertise=matched,
        )

    def _combine(self, signals: MatchSignals) -> float:
        total = 0.0
        weight = 0.0
        for signal in SIGNALS:
            value = getattr(signals, signal)
            if value is None:
                continue
            total += self._weights[signal] * value
            weight += self._weights[signal]
        return round(total / weight, 4) if weight > 0 else 0.0

    @staticmethod
    def _reasons(candidate: MatchCandidate, signals: MatchSignals) -> list[MatchReason]:
        """Evidence a person can check, from the signals that actually fired."""
        reasons: list[MatchReason] = []

        if signals.expertise is not None and signals.expertise >= 0.75:
            reasons.append(
                MatchReason(code="EXPERTISE_STRONG", signal="expertise", value=signals.expertise)
            )
        elif signals.expertise is not None and signals.expertise >= 0.45:
            reasons.append(
                MatchReason(code="EXPERTISE_RELATED", signal="expertise", value=signals.expertise)
            )

        if signals.semantic is not None and signals.semantic >= 0.7:
            reasons.append(
                MatchReason(code="SEMANTIC_HIGH", signal="semantic", value=signals.semantic)
            )
        elif signals.semantic is not None and signals.semantic >= 0.45:
            reasons.append(
                MatchReason(code="SEMANTIC_MODERATE", signal="semantic", value=signals.semantic)
            )

        distance = candidate.distance_meters
        if distance is not None and distance <= 25_000:
            reasons.append(
                MatchReason(code="WITHIN_SERVICE_AREA", signal="geographic", value=distance)
            )
        elif distance is None and candidate.same_city:
            reasons.append(MatchReason(code="SAME_CITY", signal="geographic", value=0.0))
        elif distance is not None and distance <= 100_000:
            reasons.append(MatchReason(code="IN_REGION", signal="geographic", value=distance))

        if signals.capability is not None and signals.capability >= 0.6:
            reasons.append(
                MatchReason(code="TYPE_FIT", signal="capability", value=signals.capability)
            )

        if candidate.relevant_activity_count > 0:
            reasons.append(
                MatchReason(
                    code="RELATED_ACTIVITY",
                    signal="activity",
                    value=float(candidate.relevant_activity_count),
                )
            )

        return reasons


__all__ = [
    "SIGNALS",
    "HeuristicMatchingEngine",
    "MatchingEngine",
    "ScoredCandidate",
    "TextSignals",
]
