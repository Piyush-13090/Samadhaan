import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';

/**
 * Hybrid ranking (Prompt 25).
 *
 * A transparent weighted sum of normalised signals — an initial heuristic,
 * not a trained ranking model. Weights are configuration
 * (SEARCH_WEIGHT_*); a signal that does not apply to a query (no location,
 * no query text, semantic search unavailable) is left out and the remaining
 * weights are renormalised, so scores stay comparable within one list.
 *
 * Retrieval and authorisation happen before this: only rows the caller may
 * see are ever scored.
 */

export const SIGNALS = [
  'keyword',
  'semantic',
  'geographic',
  'recency',
  'community',
] as const;
export type Signal = (typeof SIGNALS)[number];
export type Signals = Partial<Record<Signal, number | null>>;
export type Weights = Record<Signal, number>;

const REASON: Record<Signal, string> = {
  keyword: 'Matches your words',
  semantic: 'Similar in meaning',
  geographic: 'Near the place you searched',
  recency: 'Recently reported',
  community: 'Supported by the community',
};

export const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Scales raw values into 0–1 by the largest in the list (keyword ranks are relative). */
export function normaliseByMax(values: Array<number | null>): Array<number | null> {
  const max = Math.max(
    0,
    ...values.filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  return values.map((v) => (v === null ? null : max > 0 ? clamp01(v / max) : 0));
}

/** Cosine similarity → 0–1, with the floor at the semantic threshold. */
export function semanticScore(similarity: number | null, floor: number): number | null {
  if (similarity === null || !Number.isFinite(similarity)) return null;
  return clamp01((similarity - floor) / Math.max(0.05, 1 - floor));
}

export function recencyScore(ageDays: number, halfLifeDays: number): number {
  return clamp01(0.5 ** (Math.max(0, ageDays) / halfLifeDays));
}

/** Saturating: 50 supporters ≈ 1. */
export function communityScore(votes: number): number {
  return clamp01(Math.log1p(Math.max(0, votes)) / Math.log1p(50));
}

/** Linear to zero at the search radius. */
export function geographicScore(
  distanceM: number | null,
  radiusM: number | null,
): number | null {
  if (distanceM === null || radiusM === null || radiusM <= 0) return null;
  return clamp01(1 - distanceM / radiusM);
}

export interface Ranked<T> {
  item: T;
  score: number;
  signals: Signals;
  explanation: string[];
}

@Injectable()
export class SearchRankingService {
  constructor(private readonly config: AppConfig) {}

  weights(): Weights {
    return { ...this.config.search.weights };
  }

  /** Combines one item's signals; nulls are "not applicable" and drop out. */
  combine(
    signals: Signals,
    weights: Weights = this.weights(),
    reasons: Partial<Record<Signal, string>> = {},
  ): { score: number; explanation: string[] } {
    let total = 0;
    let weightSum = 0;
    const contributions: Array<[Signal, number]> = [];
    for (const signal of SIGNALS) {
      const value = signals[signal];
      const weight = weights[signal];
      if (value === null || value === undefined || weight <= 0) continue;
      total += weight * clamp01(value);
      weightSum += weight;
      contributions.push([signal, weight * clamp01(value)]);
    }
    const score = weightSum > 0 ? total / weightSum : 0;
    const explanation = contributions
      .filter(([, c]) => c > 0.02)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([signal]) => reasons[signal] ?? REASON[signal]);
    return { score: Math.round(score * 1000) / 1000, explanation };
  }

  /** Scores and orders a candidate list; ties break on a stable key. */
  rank<T>(
    items: T[],
    signalsOf: (item: T) => Signals,
    keyOf: (item: T) => string,
    weights: Weights = this.weights(),
    reasons: Partial<Record<Signal, string>> = {},
  ): Array<Ranked<T>> {
    return items
      .map((item) => {
        const signals = signalsOf(item);
        return { item, signals, ...this.combine(signals, weights, reasons) };
      })
      .sort((a, b) => b.score - a.score || keyOf(a.item).localeCompare(keyOf(b.item)));
  }
}
