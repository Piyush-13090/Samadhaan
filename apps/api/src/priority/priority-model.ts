import { createHash } from 'node:crypto';
import {
  PRIORITY_FEATURES,
  type PriorityFeatureKey,
  type PriorityReason,
  type PriorityTier,
} from '@samadhaan/shared';
import type { PriorityConfig, PriorityWeights } from '../config/app.config.js';

/**
 * The priority scoring model (Prompt 21) — pure, deterministic, testable.
 *
 * `PriorityModel` is the seam a trained model would later plug into: it takes
 * the extracted features and returns a score. Only the documented heuristic
 * baseline exists; nothing here pretends otherwise.
 */

export const SCORING_VERSION = 'priority-heuristic-v1';
export const FEATURE_VERSION = 'priority-features-v1';

/** Below this confidence a feature is scored but never cited as a reason. */
export const DRIVER_MIN_CONFIDENCE = 0.5;

/** A community-impact share may not exceed this multiple of its nominal weight. */
export const ENGAGEMENT_SHARE_CAP = 1.5;

export const FEATURE_LABELS: Record<PriorityFeatureKey, string> = {
  severity: 'Severity',
  urgency: 'Urgency',
  communityImpact: 'Community impact',
  safetyRisk: 'Safety risk',
  geographicImpact: 'Geographic impact',
  recency: 'Recency',
  affectedPopulation: 'Affected population',
  evidence: 'Evidence',
};

/** One extracted feature. `value: null` means unavailable — never a silent 0. */
export interface FeatureValue {
  value: number | null;
  /** 0–1: how well the inputs support the value. */
  confidence: number;
  source: string;
  evidence: string[];
  /** Why unavailable, or a caveat. */
  note: string | null;
  /** The phrase used when this feature drives the priority. */
  headline: string | null;
}

export type PriorityFeatures = Record<PriorityFeatureKey, FeatureValue>;

export interface ModelOutput {
  /** 0–100, two decimals. */
  score: number;
  tier: PriorityTier;
  confidence: number;
  dataCompleteness: number;
  provisional: boolean;
  /** Points each feature added to the score. */
  contributions: Record<PriorityFeatureKey, number>;
  /** A documented rule that raised the tier, if any. */
  floor: string | null;
}

export interface PriorityModel {
  readonly name: string;
  readonly version: string;
  score(features: PriorityFeatures, config: PriorityConfig): ModelOutput;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const round = (n: number, places: number) => Number(n.toFixed(places));

export function normaliseWeights(weights: PriorityWeights): PriorityWeights {
  const total = PRIORITY_FEATURES.reduce((sum, key) => sum + weights[key], 0);
  if (total <= 0) throw new Error('Priority weights must not all be zero.');
  return Object.fromEntries(
    PRIORITY_FEATURES.map((key) => [key, weights[key] / total]),
  ) as unknown as PriorityWeights;
}

export function tierFor(score: number, tiers: PriorityConfig['tiers']): PriorityTier {
  if (score >= tiers.critical) return 'CRITICAL';
  if (score >= tiers.high) return 'HIGH';
  if (score >= tiers.medium) return 'MEDIUM';
  return 'LOW';
}

const TIER_RANK: Record<PriorityTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
export const tierRank = (tier: PriorityTier) => TIER_RANK[tier];

/**
 * The heuristic baseline.
 *
 *   e_i  = w_i × c_i               (weight × confidence, available features only)
 *   S    = Σ e_i·v_i / Σ e_i       (recency excluded, see below)
 *   score = 100 × ((1 − w_r)·S + w_r·v_r)
 *
 * - **Missing data** is excluded, not zeroed: the remaining weights are
 *   renormalised, and `dataCompleteness` reports the share of weight present.
 * - **Confidence** scales a feature's weight: an uncertain AI signal cannot
 *   dominate.
 * - **Recency** is never renormalised: it adds at most its own weight (5
 *   points by default), however much else is missing.
 * - **Community impact** may not take more than 1.5× its nominal share after
 *   renormalisation, so engagement cannot dominate when other data is absent.
 * - **Safety floor**: a strong, confident safety signal on a severe problem
 *   is at least HIGH.
 */
export class HeuristicPriorityModel implements PriorityModel {
  readonly name = 'heuristic';
  readonly version = SCORING_VERSION;

  score(features: PriorityFeatures, config: PriorityConfig): ModelOutput {
    const w = normaliseWeights(config.weights);
    const contributions = Object.fromEntries(
      PRIORITY_FEATURES.map((key) => [key, 0]),
    ) as Record<PriorityFeatureKey, number>;

    const available = PRIORITY_FEATURES.filter((key) => features[key].value !== null);
    const allWeight = PRIORITY_FEATURES.reduce((sum, key) => sum + w[key], 0);
    const availableWeight = available.reduce((sum, key) => sum + w[key], 0);
    const dataCompleteness = allWeight > 0 ? availableWeight / allWeight : 0;
    const confidence =
      availableWeight > 0
        ? available.reduce(
            (sum, key) => sum + w[key] * clamp01(features[key].confidence),
            0,
          ) / availableWeight
        : 0;

    // Shares of the non-recency part, by weight × confidence.
    const pooled = available.filter((key) => key !== 'recency');
    const effective = new Map(
      pooled.map((key) => [key, w[key] * clamp01(features[key].confidence)]),
    );
    const total = [...effective.values()].reduce((a, b) => a + b, 0);
    const shares = new Map<PriorityFeatureKey, number>();
    if (total > 0) {
      for (const [key, e] of effective) shares.set(key, e / total);
      // Fairness: cap the engagement share and give the excess back to the rest.
      const nominal = w.communityImpact / (1 - w.recency || 1);
      const cap = nominal * ENGAGEMENT_SHARE_CAP;
      const community = shares.get('communityImpact');
      if (community !== undefined && community > cap && shares.size > 1) {
        const rest = 1 - community;
        shares.set('communityImpact', cap);
        for (const [key, share] of shares) {
          if (key !== 'communityImpact') shares.set(key, (share / rest) * (1 - cap));
        }
      }
    }

    const recencyWeight = features.recency.value === null ? 0 : w.recency;
    const pooledWeight = 1 - recencyWeight;
    let raw = 0;
    for (const [key, share] of shares) {
      const points = pooledWeight * share * clamp01(features[key].value ?? 0);
      contributions[key] = round(points * 100, 2);
      raw += points;
    }
    if (features.recency.value !== null) {
      const points = recencyWeight * clamp01(features.recency.value);
      contributions.recency = round(points * 100, 2);
      raw += points;
    }

    const score = round(clamp01(raw) * 100, 2);
    let tier = tierFor(score, config.tiers);
    let floor: string | null = null;
    const safety = features.safetyRisk;
    const severity = features.severity;
    if (
      safety.value !== null &&
      safety.value >= 0.85 &&
      safety.confidence >= 0.6 &&
      severity.value !== null &&
      severity.value >= 0.75 &&
      tierRank(tier) < tierRank('HIGH')
    ) {
      tier = 'HIGH';
      floor =
        'Raised to High: a strong, confident safety-risk signal on a severe problem is never ranked below High.';
    }

    return {
      score,
      tier,
      confidence: round(confidence, 4),
      dataCompleteness: round(dataCompleteness, 4),
      provisional:
        confidence < config.provisional.confidence ||
        dataCompleteness < config.provisional.completeness,
      contributions,
      floor,
    };
  }
}

/** The configured model. A trained model would be selected here. */
export function priorityModelFor(name: PriorityConfig['model']): PriorityModel {
  switch (name) {
    case 'heuristic':
      return new HeuristicPriorityModel();
  }
}

// ---------------------------------------------------------- explanation

/** Concise, evidence-based reasons. No model reasoning, ever. */
export function explain(
  features: PriorityFeatures,
  output: ModelOutput,
  extra: { info?: string[] } = {},
): PriorityReason[] {
  const reasons: PriorityReason[] = [];
  // A driver is a strong signal that the inputs actually support: a value
  // judged with low confidence (a category prior, a vague report) is not
  // offered as a reason, though it still counts — weakly — in the score.
  const drivers = PRIORITY_FEATURES.filter(
    (key) =>
      features[key].value !== null &&
      features[key].headline &&
      features[key].confidence >= DRIVER_MIN_CONFIDENCE &&
      (features[key].value ?? 0) >= (key === 'recency' ? 0.7 : 0.55),
  ).sort((a, b) => output.contributions[b] - output.contributions[a]);
  for (const key of drivers.slice(0, 5)) {
    reasons.push({ kind: 'driver', feature: key, text: features[key].headline! });
  }
  if (output.floor)
    reasons.push({ kind: 'info', feature: 'safetyRisk', text: output.floor });
  for (const text of extra.info ?? [])
    reasons.push({ kind: 'info', feature: null, text });
  for (const key of PRIORITY_FEATURES) {
    if (features[key].value === null) {
      reasons.push({
        kind: 'warning',
        feature: key,
        text: `${FEATURE_LABELS[key]} unavailable${features[key].note ? ` — ${features[key].note}` : ''}`,
      });
    }
  }
  if (output.provisional) {
    reasons.push({
      kind: 'warning',
      feature: null,
      text: `Provisional: confidence ${Math.round(output.confidence * 100)}%, data completeness ${Math.round(
        output.dataCompleteness * 100,
      )}%. Check the evidence before relying on this tier.`,
    });
  }
  return reasons;
}

// ------------------------------------------------------------- history

export interface ComparableAssessment {
  score: number;
  tier: PriorityTier;
  components: Record<PriorityFeatureKey, number | null>;
}

/** What materially changed between two assessments, in words. */
export function describeChanges(
  previous: ComparableAssessment | null,
  next: ComparableAssessment,
): string[] {
  if (!previous) return ['First assessment.'];
  const changes: string[] = [];
  if (previous.tier !== next.tier) {
    changes.push(`Tier ${previous.tier.toLowerCase()} → ${next.tier.toLowerCase()}.`);
  }
  const delta = next.score - previous.score;
  if (Math.abs(delta) >= 1) {
    changes.push(
      `Score ${previous.score.toFixed(0)} → ${next.score.toFixed(0)} (${delta > 0 ? '+' : ''}${delta.toFixed(0)}).`,
    );
  }
  for (const key of PRIORITY_FEATURES) {
    const before = previous.components[key];
    const after = next.components[key];
    if (before === null && after !== null) {
      changes.push(`${FEATURE_LABELS[key]} became available.`);
    } else if (before !== null && after === null) {
      changes.push(`${FEATURE_LABELS[key]} is no longer available.`);
    } else if (before !== null && after !== null && Math.abs(after - before) >= 0.1) {
      changes.push(
        `${FEATURE_LABELS[key]} ${after > before ? 'rose' : 'fell'} (${Math.round(before * 100)} → ${Math.round(
          after * 100,
        )}).`,
      );
    }
  }
  return changes;
}

/**
 * Fingerprint of an outcome, for history de-duplication: tier, the score in
 * 2-point steps, each component in 0.1 steps, and the versions. Recalculations
 * that land on the same fingerprint confirm the latest row instead of adding one.
 */
export function outcomeHash(
  assessment: ComparableAssessment,
  versions: { scoring: string; feature: string },
): string {
  const parts = [
    assessment.tier,
    Math.round(assessment.score / 2),
    ...PRIORITY_FEATURES.map((key) => {
      const v = assessment.components[key];
      return v === null ? 'x' : Math.round(v * 10);
    }),
    versions.scoring,
    versions.feature,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}
