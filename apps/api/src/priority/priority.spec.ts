import { PRIORITY_FEATURES, type PriorityFeatureKey } from '@samadhaan/shared';
import { describe, expect, it } from 'vitest';
import { parsePriorityFeatures } from '../ai/dto/priority.dto.js';
import type { PriorityConfig } from '../config/app.config.js';
import { planNotifications } from '../notifications/notification-planner.js';
import {
  aiLocality,
  combine,
  communityImpact,
  populationScore,
} from './priority-feature.service.js';
import {
  HeuristicPriorityModel,
  describeChanges,
  explain,
  normaliseWeights,
  outcomeHash,
  tierFor,
  type FeatureValue,
  type PriorityFeatures,
} from './priority-model.js';

const config: PriorityConfig = {
  enabled: true,
  model: 'heuristic',
  aiFeatures: true,
  weights: {
    severity: 0.2,
    urgency: 0.15,
    communityImpact: 0.2,
    safetyRisk: 0.15,
    geographicImpact: 0.1,
    recency: 0.05,
    affectedPopulation: 0.1,
    evidence: 0.05,
  },
  tiers: { critical: 80, high: 60, medium: 35 },
  provisional: { confidence: 0.5, completeness: 0.6 },
  debounceMs: 0,
  scheduleMinutes: 0,
  refreshHours: 24,
  batchSize: 10,
  sweepOnStartup: false,
  aiReuseDays: 30,
  recencyHalfLifeDays: 14,
  nearbyRadiusM: 500,
  baselineRadiusM: 5000,
  guidanceTopK: 0,
};

const feature = (
  value: number | null,
  confidence = 1,
  headline: string | null = null,
): FeatureValue => ({
  value,
  confidence: value === null ? 0 : confidence,
  source: 'test',
  evidence: [],
  note: value === null ? 'not known' : null,
  headline,
});

function features(
  overrides: Partial<Record<PriorityFeatureKey, FeatureValue>> = {},
): PriorityFeatures {
  const base = Object.fromEntries(
    PRIORITY_FEATURES.map((k) => [k, feature(0.5)]),
  ) as PriorityFeatures;
  return { ...base, ...overrides };
}

const model = new HeuristicPriorityModel();

describe('weights and tiers', () => {
  it('normalises weights to sum to one', () => {
    const w = normaliseWeights({ ...config.weights, severity: 0.4 });
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(() =>
      normaliseWeights(Object.fromEntries(PRIORITY_FEATURES.map((k) => [k, 0])) as never),
    ).toThrow();
  });

  it('maps scores to the configured tiers, inclusive at the lower bound', () => {
    expect(tierFor(80, config.tiers)).toBe('CRITICAL');
    expect(tierFor(79.99, config.tiers)).toBe('HIGH');
    expect(tierFor(60, config.tiers)).toBe('HIGH');
    expect(tierFor(35, config.tiers)).toBe('MEDIUM');
    expect(tierFor(34.9, config.tiers)).toBe('LOW');
    expect(tierFor(50, { critical: 90, high: 70, medium: 50 })).toBe('MEDIUM');
  });
});

describe('weighted score', () => {
  it('is the weighted mean, in points', () => {
    const out = model.score(features(), config);
    expect(out.score).toBeCloseTo(50, 1);
    expect(out.tier).toBe('MEDIUM');
    expect(out.dataCompleteness).toBe(1);
    expect(out.confidence).toBe(1);
    const total = Object.values(out.contributions).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(out.score, 1);
  });

  it('scores the extremes 0 and 100', () => {
    const all = (v: number) =>
      features(
        Object.fromEntries(PRIORITY_FEATURES.map((k) => [k, feature(v)])) as never,
      );
    expect(model.score(all(1), config).score).toBe(100);
    expect(model.score(all(0), config).score).toBe(0);
  });
});

describe('missing data', () => {
  it('excludes unavailable features instead of scoring them as zero', () => {
    const out = model.score(
      features({ affectedPopulation: feature(null), geographicImpact: feature(null) }),
      config,
    );
    // Everything else is 0.5: renormalised, the score stays 50 — not dragged down.
    expect(out.score).toBeCloseTo(50, 1);
    expect(out.dataCompleteness).toBeCloseTo(0.8);
    expect(out.contributions.affectedPopulation).toBe(0);
  });

  it('marks low completeness as provisional', () => {
    const missing = (keys: PriorityFeatureKey[]) =>
      features(Object.fromEntries(keys.map((k) => [k, feature(null)])) as never);
    const enough = model.score(
      missing(['affectedPopulation', 'geographicImpact', 'safetyRisk']),
      config,
    );
    expect(enough.dataCompleteness).toBeCloseTo(0.65);
    expect(enough.provisional).toBe(false);
    const sparse = model.score(
      missing([
        'affectedPopulation',
        'geographicImpact',
        'safetyRisk',
        'urgency',
        'evidence',
      ]),
      config,
    );
    expect(sparse.dataCompleteness).toBeCloseTo(0.45);
    expect(sparse.provisional).toBe(true);
  });
});

describe('confidence', () => {
  it('lets an uncertain signal count for less', () => {
    const sure = model.score(features({ safetyRisk: feature(1, 1) }), config);
    const unsure = model.score(features({ safetyRisk: feature(1, 0.2) }), config);
    expect(unsure.score).toBeLessThan(sure.score);
    expect(unsure.contributions.safetyRisk).toBeLessThan(
      sure.contributions.safetyRisk / 3,
    );
  });

  it('reports the weighted mean confidence', () => {
    const out = model.score(features({ severity: feature(0.5, 0.5) }), config);
    expect(out.confidence).toBeCloseTo(0.9);
  });

  it('cannot be dominated by a confident-sounding but low-confidence AI value', () => {
    const quiet = features(
      Object.fromEntries(PRIORITY_FEATURES.map((k) => [k, feature(0.2)])) as never,
    );
    const out = model.score({ ...quiet, safetyRisk: feature(1, 0.1) }, config);
    expect(out.tier).toBe('LOW');
  });
});

describe('fairness safeguards', () => {
  it('caps recency at its own weight, however much else is missing', () => {
    const sparse = Object.fromEntries(
      PRIORITY_FEATURES.map((k) => [k, feature(null)]),
    ) as PriorityFeatures;
    const out = model.score(
      {
        ...sparse,
        recency: feature(1),
        evidence: feature(0),
        communityImpact: feature(0),
      },
      config,
    );
    expect(out.score).toBeCloseTo(5, 1);
    expect(out.tier).toBe('LOW');
  });

  it('caps the community-impact share when other data is missing', () => {
    const sparse = Object.fromEntries(
      PRIORITY_FEATURES.map((k) => [k, feature(null)]),
    ) as PriorityFeatures;
    const out = model.score(
      {
        ...sparse,
        communityImpact: feature(1),
        severity: feature(0.2),
        evidence: feature(0.2),
      },
      config,
    );
    // Uncapped, popularity would carry 4/9 of the score; capped at 1.5× its
    // nominal share (recency is unavailable, so the pool is the whole score).
    const share = 0.2 / 0.95;
    expect(out.contributions.communityImpact).toBeCloseTo(100 * share * 1.5, 0);
    expect(out.contributions.communityImpact).toBeLessThan(100 * (0.2 / 0.45));
    expect(out.tier).not.toBe('CRITICAL');
  });

  it('normalises engagement to the local area', () => {
    // Ten people in a quiet area weigh like thirty in a busy one.
    expect(communityImpact(10, 2)).toBeCloseTo(communityImpact(30, 9), 1);
    expect(communityImpact(0, 5)).toBe(0);
    // A floor on the baseline stops a single supporter from saturating.
    expect(communityImpact(1, 0)).toBeLessThan(0.3);
    expect(communityImpact(1000, 1)).toBeLessThanOrEqual(1);
  });
});

describe('safety floor', () => {
  it('keeps a confident, severe safety risk at least High', () => {
    const low = Object.fromEntries(
      PRIORITY_FEATURES.map((k) => [k, feature(0.1)]),
    ) as PriorityFeatures;
    const out = model.score(
      { ...low, safetyRisk: feature(0.9, 0.8), severity: feature(0.8, 0.8) },
      config,
    );
    expect(out.tier).toBe('HIGH');
    expect(out.floor).toMatch(/never ranked below High/);
    const unsure = model.score(
      { ...low, safetyRisk: feature(0.9, 0.4), severity: feature(0.8) },
      config,
    );
    expect(unsure.floor).toBeNull();
  });
});

describe('feature helpers', () => {
  it('sends the AI only a neighbourhood and city — no house numbers or postcodes', () => {
    expect(aiLocality('12 Example Lane, Kothrud', 'Pune')).toBe('Kothrud, Pune');
    expect(aiLocality('Plot 4, Sector 12, Kothrud, Pune 411038', 'Pune')).toBe(
      'Kothrud, Pune',
    );
    expect(aiLocality(null, 'Pune')).toBe('Pune');
    expect(aiLocality('7 MG Road', null)).toBeNull();
  });

  it('combines estimates by confidence', () => {
    const one = combine([
      { value: 0.8, confidence: 0.35 },
      { value: null, confidence: 0 },
    ]);
    expect(one.value!).toBeCloseTo(0.8);
    expect(one.confidence).toBe(0.35);
    const both = combine([
      { value: 0.4, confidence: 0.35 },
      { value: 0.9, confidence: 0.9 },
    ]);
    expect(both.value!).toBeGreaterThan(0.75);
    expect(both.confidence).toBe(0.9);
    expect(combine([]).value).toBeNull();
  });

  it('scores stated populations on a log scale, households as three people', () => {
    expect(populationScore(100, 'people')).toBeCloseTo(0.5, 2);
    expect(populationScore(10000, 'people')).toBeCloseTo(1, 2);
    expect(populationScore(200, 'households')).toBeCloseTo(
      populationScore(600, 'people'),
    );
  });
});

describe('explanations', () => {
  it('lists drivers by contribution and flags what is missing', () => {
    const f = features({
      severity: feature(0.9, 1, 'High severity'),
      safetyRisk: feature(0.95, 1, 'Strong safety-risk signal'),
      recency: feature(0.4, 1, 'Recently reported'),
      affectedPopulation: feature(null),
    });
    const out = model.score(f, config);
    const reasons = explain(f, out, { info: ['An organisation is working on this.'] });
    expect(reasons.filter((r) => r.kind === 'driver').map((r) => r.text)).toEqual([
      'High severity',
      'Strong safety-risk signal',
    ]);
    expect(reasons).toContainEqual({
      kind: 'warning',
      feature: 'affectedPopulation',
      text: 'Affected population unavailable — not known',
    });
    expect(reasons.some((r) => r.kind === 'info')).toBe(true);
  });

  it('never cites a low-confidence signal as a reason', () => {
    const f = features({
      safetyRisk: feature(0.9, 0.35, 'Safety risk typical of this category'),
    });
    const reasons = explain(f, model.score(f, config));
    expect(reasons.map((r) => r.text)).not.toContain(
      'Safety risk typical of this category',
    );
  });

  it('describes what changed between assessments', () => {
    const components = Object.fromEntries(
      PRIORITY_FEATURES.map((k) => [k, 0.5]),
    ) as Record<PriorityFeatureKey, number | null>;
    const before = { score: 48, tier: 'MEDIUM' as const, components };
    const after = {
      score: 71,
      tier: 'HIGH' as const,
      components: {
        ...before.components,
        communityImpact: 0.8,
        safetyRisk: 0.82,
        affectedPopulation: null,
      },
    };
    const changes = describeChanges(before, after);
    expect(changes).toContain('Tier medium → high.');
    expect(changes).toContain('Score 48 → 71 (+23).');
    expect(changes).toContain('Community impact rose (50 → 80).');
    expect(changes).toContain('Affected population is no longer available.');
    expect(describeChanges(null, after)).toEqual(['First assessment.']);
  });

  it('de-duplicates history: small drifts share a fingerprint', () => {
    const components = Object.fromEntries(
      PRIORITY_FEATURES.map((k) => [k, 0.5]),
    ) as never;
    const v = { scoring: 's', feature: 'f' };
    const a = outcomeHash({ score: 50.2, tier: 'MEDIUM', components }, v);
    expect(outcomeHash({ score: 50.6, tier: 'MEDIUM', components }, v)).toBe(a);
    expect(outcomeHash({ score: 56, tier: 'MEDIUM', components }, v)).not.toBe(a);
    expect(
      outcomeHash({ score: 50.2, tier: 'MEDIUM', components }, { ...v, scoring: 't' }),
    ).not.toBe(a);
  });
});

describe('AI feature parsing', () => {
  const body = {
    safety_risk: { value: 0.9, confidence: 0.8, evidence: ['live wire'] },
    urgency: { value: 0.7, confidence: 0.6, evidence: [] },
    impact_breadth: { value: null, confidence: 0.4, evidence: ['x'] },
    stated_affected: {
      value: 200,
      unit: 'households',
      confidence: 0.9,
      evidence: ['200 families'],
    },
    ai_ran: true,
    provider: 'anthropic',
    model_name: 'm',
    model_version: '1',
    prompt_version: 'p',
  };

  it('accepts a valid response; null values carry no confidence', () => {
    const parsed = parsePriorityFeatures(body)!;
    expect(parsed.safetyRisk).toEqual({
      value: 0.9,
      confidence: 0.8,
      evidence: ['live wire'],
    });
    expect(parsed.impactBreadth).toEqual({ value: null, confidence: 0, evidence: [] });
    expect(parsed.statedAffected.value).toBe(200);
  });

  it('rejects out-of-range values and dishonest "no model" responses', () => {
    expect(
      parsePriorityFeatures({ ...body, safety_risk: { value: 1.4, confidence: 1 } }),
    ).toBeNull();
    expect(parsePriorityFeatures({ ...body, ai_ran: false })).toBeNull();
    expect(parsePriorityFeatures({ ...body, provider: undefined })).toBeNull();
  });
});

describe('escalation notifications', () => {
  const event = {
    type: 'PRIORITY_TIER_CHANGED' as const,
    problemId: 'p',
    problemPublicId: 'SAM-1042',
    assessmentId: 'a1',
    fromTier: 'HIGH' as const,
    toTier: 'CRITICAL' as const,
    score: 86.4,
  };
  const recipients = [{ userId: 'u1', governmentSlug: 'pune' }];

  it('tells covering officials once per assessment', () => {
    const drafts = planNotifications(event, { escalationRecipients: recipients });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      recipientId: 'u1',
      type: 'PRIORITY_ESCALATED',
      dedupeKey: 'priority_escalated:a1',
      metadata: { problemPublicId: 'SAM-1042', governmentSlug: 'pune' },
    });
  });

  it('stays quiet for non-critical changes and when an official already decided', () => {
    expect(
      planNotifications(
        { ...event, toTier: 'HIGH' },
        { escalationRecipients: recipients },
      ),
    ).toEqual([]);
    expect(
      planNotifications(
        { ...event, fromTier: 'CRITICAL' },
        { escalationRecipients: recipients },
      ),
    ).toEqual([]);
    expect(
      planNotifications(event, { escalationRecipients: recipients, overridden: true }),
    ).toEqual([]);
  });
});
