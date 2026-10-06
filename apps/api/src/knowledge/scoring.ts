import type { KnowledgeSourceType } from '@samadhaan/shared';
import type { RagWeights } from '../config/app.config.js';

/**
 * Baseline hybrid ranking (Prompt 20) — deterministic and documented, not a
 * learned model. Each signal is in [0, 1]; the score is their weighted sum
 * (weights from configuration, normalised to sum to 1):
 *
 *   semantic   cosine similarity of query and chunk embeddings (pgvector)
 *   keyword    share of the query's terms (English-stemmed) the chunk contains
 *   source     how authoritative the source type is for this context
 *   context    category and city match with the problem or project
 *   recency    exponential decay on the source's last update (1-year half-life)
 *
 * A learned re-ranker can later replace `score` without touching retrieval.
 */

export const RETRIEVAL_VERSION = 'hybrid-baseline-v1';

export interface Candidate {
  chunkId: string;
  documentId: string;
  sourceId: string;
  content: string;
  sectionTitle: string | null;
  pageNumber: number | null;
  title: string;
  sourceType: KnowledgeSourceType;
  categories: string[];
  city: string | null;
  updatedAt: Date;
  /** Cosine similarity, already 1 − distance. */
  semantic: number;
  keyword: number;
  /** The chunk embedding, as returned for diversity re-ranking (never sent out). */
  embedding?: number[];
}

export interface RetrievalContext {
  kind: 'GENERAL' | 'PROBLEM' | 'PROJECT';
  category: string | null;
  city: string | null;
}

export interface Scored extends Candidate {
  score: number;
  signals: {
    semantic: number;
    keyword: number;
    source: number;
    context: number;
    recency: number;
  };
}

const clamp = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Authority of a source type for the kind of question asked. */
export function sourceRelevance(
  type: KnowledgeSourceType,
  context: RetrievalContext,
): number {
  switch (type) {
    case 'CIVIC_GUIDELINE':
    case 'GOVERNMENT_POLICY':
      return 1;
    case 'PROJECT_DOCUMENT':
    case 'PROJECT_NOTE':
      return context.kind === 'PROJECT' ? 1 : 0.6;
    case 'ORGANIZATION_DOCUMENT':
    case 'PROBLEM_CONTEXT':
      return 0.7;
    case 'WEB_REFERENCE':
      return 0.5;
    default:
      return 0.4;
  }
}

/** 1 for a category (and city) match, 0.5 for general guidance, low for a mismatch. */
export function contextRelevance(
  candidate: Pick<Candidate, 'categories' | 'city'>,
  context: RetrievalContext,
): number {
  if (!context.category) return 0.5;
  let value =
    candidate.categories.length === 0
      ? 0.5
      : candidate.categories.includes(context.category)
        ? 1
        : 0.1;
  if (candidate.city && context.city) {
    value =
      candidate.city.toLowerCase() === context.city.toLowerCase()
        ? Math.min(1, value + 0.2)
        : value * 0.5;
  }
  return value;
}

export function recency(updatedAt: Date, now: Date): number {
  const days = Math.max(0, (now.getTime() - updatedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, days / 365);
}

export function normaliseWeights(weights: RagWeights): RagWeights {
  const total =
    weights.semantic +
    weights.keyword +
    weights.source +
    weights.context +
    weights.recency;
  if (total <= 0) return { semantic: 1, keyword: 0, source: 0, context: 0, recency: 0 };
  return {
    semantic: weights.semantic / total,
    keyword: weights.keyword / total,
    source: weights.source / total,
    context: weights.context / total,
    recency: weights.recency / total,
  };
}

export function score(
  candidates: Candidate[],
  context: RetrievalContext,
  weights: RagWeights,
  now = new Date(),
): Scored[] {
  const w = normaliseWeights(weights);
  return candidates
    .map((candidate) => {
      const signals = {
        semantic: clamp(candidate.semantic),
        keyword: clamp(candidate.keyword),
        source: sourceRelevance(candidate.sourceType, context),
        context: contextRelevance(candidate, context),
        recency: recency(candidate.updatedAt, now),
      };
      const total =
        signals.semantic * w.semantic +
        signals.keyword * w.keyword +
        signals.source * w.source +
        signals.context * w.context +
        signals.recency * w.recency;
      return { ...candidate, signals, score: Math.round(total * 10_000) / 10_000 };
    })
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Maximal marginal relevance over the top `pool` results: prefer passages that
 * add something the already-chosen ones do not (λ = 0.75). Keeps the model
 * from receiving five near-identical overlapping chunks. Deterministic.
 */
export function diversify(
  scored: Scored[],
  k: number,
  pool: number,
  lambda = 0.75,
): Scored[] {
  const candidates = scored.slice(0, Math.max(k, pool));
  const chosen: Scored[] = [];
  while (chosen.length < k && candidates.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    candidates.forEach((candidate, index) => {
      const redundancy = chosen.length
        ? Math.max(
            ...chosen.map((c) =>
              candidate.embedding && c.embedding
                ? cosine(candidate.embedding, c.embedding)
                : c.documentId === candidate.documentId
                  ? 0.5
                  : 0,
            ),
          )
        : 0;
      const value = lambda * candidate.score - (1 - lambda) * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    chosen.push(candidates.splice(bestIndex, 1)[0]!);
  }
  return chosen;
}
