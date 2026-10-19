"""Text features shared by training and serving (Prompt 28).

One implementation of tokenisation, vocabulary and TF-IDF weighting, used by
`ml/training.py` to fit a model and by `app/models/linear.py` to serve it, so
the features a model was trained on are exactly the features it is given. The
fitted state is plain JSON (vocabulary and idf), never a pickle.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from app.models.privacy import redact_text

TOKEN_PATTERN = re.compile(r"[^\W_]{2,}|\[[A-Z_]+\]")
MAX_TEXT_CHARS = 6000


def problem_text(title: str | None, description: str | None, category: str | None = None) -> str:
    """The canonical model input for a report: title, description and, for
    `problem-text-category-v1`, the category as a reserved token."""
    parts = [title or "", description or ""]
    if category:
        # One token per category: "catxpublicsafety" (underscores would split it).
        parts.append(f"__category_{category.lower().replace('_', '')}")
    return "\n".join(parts)[:MAX_TEXT_CHARS]


def tokenize(text: str, ngram_max: int = 2) -> list[str]:
    """NFKC, lower-case (identifier tokens excepted), redact, then words and n-grams."""
    redacted, _ = redact_text(unicodedata.normalize("NFKC", text))
    words = [
        t if t.startswith("[") else t.lower()
        for t in TOKEN_PATTERN.findall(redacted.replace("__category_", " catx"))
    ]
    grams = list(words)
    for n in range(2, ngram_max + 1):
        grams.extend(" ".join(words[i : i + n]) for i in range(len(words) - n + 1))
    return grams


@dataclass(frozen=True)
class TfidfState:
    vocabulary: dict[str, int]
    idf: list[float]
    ngram_max: int

    def to_json(self) -> dict[str, object]:
        terms = sorted(self.vocabulary, key=self.vocabulary.__getitem__)
        return {"terms": terms, "idf": self.idf, "ngram_max": self.ngram_max}

    @classmethod
    def from_json(cls, data: dict[str, object]) -> TfidfState:
        terms = data["terms"]
        idf = data["idf"]
        if not isinstance(terms, list) or not isinstance(idf, list) or len(terms) != len(idf):
            raise ValueError("vocabulary and idf must be lists of equal length")
        return cls(
            vocabulary={str(t): i for i, t in enumerate(terms)},
            idf=[float(v) for v in idf],
            ngram_max=int(data.get("ngram_max", 2)),  # type: ignore[arg-type]
        )


def fit_tfidf(
    texts: Sequence[str], *, min_df: int = 2, max_features: int = 20000, ngram_max: int = 2
) -> TfidfState:
    """Document frequencies over the training texts only. Ties are broken
    alphabetically, so the same texts always give the same vocabulary."""
    df: Counter[str] = Counter()
    for text in texts:
        df.update(set(tokenize(text, ngram_max)))
    kept = sorted((t for t, c in df.items() if c >= min_df), key=lambda t: (-df[t], t))
    kept = sorted(kept[:max_features])
    n = len(texts)
    return TfidfState(
        vocabulary={t: i for i, t in enumerate(kept)},
        idf=[math.log((1 + n) / (1 + df[t])) + 1.0 for t in kept],
        ngram_max=ngram_max,
    )


@dataclass(frozen=True)
class SparseVector:
    indices: list[int]
    values: list[float]
    tokens: int
    known_tokens: int

    @property
    def known_ratio(self) -> float:
        return self.known_tokens / self.tokens if self.tokens else 0.0


def transform(state: TfidfState, text: str) -> SparseVector:
    """Sublinear tf × idf, L2-normalised. Also reports how much of the input the
    vocabulary knew, which serving uses to refuse out-of-distribution text."""
    tokens = tokenize(text, state.ngram_max)
    counts = Counter(t for t in tokens if t in state.vocabulary)
    pairs = sorted(
        (state.vocabulary[t], (1.0 + math.log(c)) * state.idf[state.vocabulary[t]])
        for t, c in counts.items()
    )
    norm = math.sqrt(sum(v * v for _, v in pairs)) or 1.0
    return SparseVector(
        indices=[i for i, _ in pairs],
        values=[v / norm for _, v in pairs],
        tokens=len(tokens),
        known_tokens=sum(counts.values()),
    )


def transform_many(state: TfidfState, texts: Iterable[str]) -> list[SparseVector]:
    return [transform(state, t) for t in texts]
