"""Runs the development evaluation set through the real matching pipeline.

    services/ai/.venv/bin/python -m evaluation.organization_matching   (from services/ai)

It reproduces what the API does — profile and problem texts, cosine
similarity, distance — with the configured embedding model, then reports
precision@1 and NDCG@3 against the hand-written labels. A **development
evaluation set**: it catches regressions and nonsense rankings. It is not a
benchmark and its numbers say nothing about real-world accuracy.
"""

from __future__ import annotations

import asyncio
import json
import math
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings
from app.matching.features import cosine
from app.providers.embedding_base import EmbeddingProvider
from app.providers.embedding_factory import build_embedding_provider
from app.schemas.matching import (
    MatchCandidate,
    MatchExpertise,
    MatchOptions,
    MatchOrganizationsRequest,
    MatchProblem,
)
from app.services.matching_service import MatchingService, build_engine

DATASET = Path(__file__).with_name("organization_matching_dev.json")


def words(category: str) -> str:
    return category.replace("_", " ").lower()


def organization_profile_text(org: dict) -> str:
    """Mirrors `buildOrganizationProfileText` in the API. Keep them in step."""
    areas = "; ".join(
        f"{words(entry['category'])}: {entry['subcategory']}"
        if entry["subcategory"]
        else words(entry["category"])
        for entry in org["expertise"]
    )
    return "\n".join(
        part
        for part in [
            org["name"],
            f"Organisation type: {org['type'].lower()}",
            org.get("description") or "",
            f"Areas of work: {areas}" if areas else "",
        ]
        if part
    )


def problem_text(problem: dict) -> str:
    """Mirrors `buildCanonicalText` in the API."""
    return "\n".join(
        part
        for part in [
            problem["title"],
            problem["description"],
            f"Category: {problem['category']}",
            f"Issue: {problem['subcategory']}" if problem.get("subcategory") else "",
            problem.get("city") or "",
        ]
        if part
    )


def haversine(a: list[float], b: list[float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


@dataclass
class ProblemResult:
    problem_id: str
    ranking: list[tuple[str, float]]
    precision_at_1: float
    ndcg_at_3: float


def ndcg(ranked: list[str], labels: dict[str, int], k: int) -> float:
    def dcg(grades: list[int]) -> float:
        return sum((2**grade - 1) / math.log2(i + 2) for i, grade in enumerate(grades[:k]))

    ideal = dcg(sorted(labels.values(), reverse=True))
    return dcg([labels.get(org, 0) for org in ranked]) / ideal if ideal else 0.0


async def evaluate(provider: EmbeddingProvider) -> list[ProblemResult]:
    data = json.loads(DATASET.read_text())
    orgs = data["organizations"]
    org_vectors = await provider.embed_texts([organization_profile_text(o) for o in orgs])
    service = MatchingService(build_engine(get_settings()), provider)

    results: list[ProblemResult] = []
    for problem in data["problems"]:
        text = problem_text(problem)
        (vector,) = await provider.embed_texts([text])
        candidates = [
            MatchCandidate(
                organization_id=org["id"],
                type=org["type"],
                expertise=[MatchExpertise(**entry) for entry in org["expertise"]],
                semantic_similarity=cosine(vector, org_vectors[index]),
                distance_meters=haversine(problem["location"], org["location"]),
                same_city=org["city"] == problem["city"],
                has_location=True,
            )
            for index, org in enumerate(orgs)
        ]
        response = await service.match(
            MatchOrganizationsRequest(
                problem=MatchProblem(
                    public_id=problem["id"],
                    category=problem["category"],
                    subcategory=problem["subcategory"],
                    focus_text=text,
                ),
                candidates=candidates,
                options=MatchOptions(result_limit=len(orgs), min_score=0.0),
            )
        )
        ranking = [(m.organization_id, m.final_score) for m in response.matches]
        ranked = [org for org, _ in ranking]
        labels = problem["relevance"]
        results.append(
            ProblemResult(
                problem_id=problem["id"],
                ranking=ranking,
                precision_at_1=1.0 if labels.get(ranked[0], 0) == 2 else 0.0,
                ndcg_at_3=ndcg(ranked, labels, 3),
            )
        )
    return results


def main() -> None:
    provider = build_embedding_provider(get_settings())
    results = asyncio.run(evaluate(provider))
    print(f"Development evaluation set — {provider.info.model_name}")
    print(f"Engine: {build_engine(get_settings()).matching_version}\n")
    for result in results:
        top = ", ".join(f"{org} {score:.2f}" for org, score in result.ranking[:4])
        print(
            f"{result.problem_id:13} P@1={result.precision_at_1:.0f} "
            f"NDCG@3={result.ndcg_at_3:.2f}  {top}"
        )
    count = len(results)
    print(
        f"\nmean P@1={sum(r.precision_at_1 for r in results) / count:.2f} "
        f"mean NDCG@3={sum(r.ndcg_at_3 for r in results) / count:.2f}"
    )


if __name__ == "__main__":
    main()
