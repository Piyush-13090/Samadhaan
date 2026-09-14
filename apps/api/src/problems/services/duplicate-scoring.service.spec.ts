import { describe, expect, it } from 'vitest';
import type { DuplicateDetectionConfig } from '../../config/app.config.js';
import {
  DuplicateScoringService,
  type DuplicateScoreInput,
} from './duplicate-scoring.service.js';

/** The shipped defaults, so the tests assert the behaviour operators get. */
const CONFIG: DuplicateDetectionConfig = {
  geoRadiusMeters: 750,
  maxDistanceMeters: 5000,
  geoGateFloor: 0.25,
  categoryGateFloor: 0.4,
  candidateLimit: 20,
  resultLimit: 5,
  minTextSimilarity: 0.35,
  weights: { text: 0.35, image: 0.25, geographic: 0.25, category: 0.1, temporal: 0.05 },
  highThreshold: 0.85,
  possibleThreshold: 0.65,
  relatedThreshold: 0.5,
  temporalHalfLifeDays: 120,
  temporalFloor: 0.35,
};

const service = new DuplicateScoringService();

function input(overrides: Partial<DuplicateScoreInput> = {}): DuplicateScoreInput {
  return {
    textSimilarity: 0.9,
    imageSimilarity: null,
    distanceMeters: 120,
    category: 'POTHOLES',
    candidateCategory: 'POTHOLES',
    subcategory: null,
    candidateSubcategory: null,
    ageGapDays: 3,
    ...overrides,
  };
}

describe('geographicSimilarity', () => {
  it('is 1 at zero distance and 0.5 at exactly the radius', () => {
    expect(service.geographicSimilarity(0, 750)).toBe(1);
    expect(service.geographicSimilarity(750, 750)).toBeCloseTo(0.5, 5);
  });

  it('falls away sharply beyond the radius', () => {
    const atDouble = service.geographicSimilarity(1500, 750)!;
    const atTriple = service.geographicSimilarity(2250, 750)!;

    expect(atDouble).toBeCloseTo(0.0625, 4);
    expect(atTriple).toBeLessThan(0.01);
  });

  it('decreases monotonically with distance', () => {
    const scores = [0, 50, 100, 300, 750, 1500, 3000].map(
      (meters) => service.geographicSimilarity(meters, 750)!,
    );

    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    }
  });

  // Unavailable is not the same as far away, and the difference decides
  // whether the weight is redistributed or the pair is penalised.
  it('returns null when distance is unknown', () => {
    expect(service.geographicSimilarity(null, 750)).toBeNull();
  });
});

describe('categorySimilarity', () => {
  it('is 1 for an identical category', () => {
    expect(service.categorySimilarity('POTHOLES', 'POTHOLES')).toBe(1);
  });

  it('rates a related civic category highly', () => {
    expect(service.categorySimilarity('ROADS', 'POTHOLES')).toBe(0.9);
    expect(service.categorySimilarity('GARBAGE', 'SANITATION')).toBe(0.85);
  });

  it('is symmetric', () => {
    expect(service.categorySimilarity('POTHOLES', 'ROADS')).toBe(
      service.categorySimilarity('ROADS', 'POTHOLES'),
    );
  });

  it('rates an unrelated category very low, but never zero', () => {
    const score = service.categorySimilarity('POTHOLES', 'STREETLIGHTS');

    expect(score).toBe(0.1);
    expect(score).toBeGreaterThan(0);
  });

  // OTHER is where a reporter lands when no heading fits, so matching it
  // strictly would hide the reports most likely to be mis-filed.
  it('treats OTHER as weakly compatible with everything', () => {
    expect(service.categorySimilarity('OTHER', 'POTHOLES')).toBe(0.4);
    expect(service.categorySimilarity('POTHOLES', 'OTHER')).toBe(0.4);
  });

  // Capped at 1, so a matching subcategory cannot raise it further; it earns
  // its place in the evidence list instead.
  it('never exceeds 1', () => {
    expect(service.categorySimilarity('POTHOLES', 'POTHOLES')).toBe(1);
    expect(service.categorySimilarity('ROADS', 'POTHOLES')).toBeLessThanOrEqual(1);
  });
});

describe('temporalSimilarity', () => {
  it('is 1 for reports filed the same day', () => {
    expect(service.temporalSimilarity(0, CONFIG)).toBe(1);
  });

  it('halves the decaying portion after one half-life', () => {
    // floor + (1 - floor) * 0.5 = 0.35 + 0.325
    expect(service.temporalSimilarity(120, CONFIG)).toBeCloseTo(0.675, 4);
  });

  /**
   * The property that matters most here. A pothole unrepaired for two years is
   * still the same pothole when someone reports it again — age may lower a
   * score but must never make an old problem unmatchable.
   */
  it('never falls below the configured floor, however old', () => {
    expect(service.temporalSimilarity(730, CONFIG)).toBeGreaterThanOrEqual(0.35);
    expect(service.temporalSimilarity(100_000, CONFIG)).toBeGreaterThanOrEqual(0.35);
  });

  it('treats a negative gap as zero rather than amplifying the score', () => {
    expect(service.temporalSimilarity(-50, CONFIG)).toBe(1);
  });
});

describe('score', () => {
  it('is deterministic for the same inputs', () => {
    const first = service.score(input(), CONFIG);
    const second = service.score(input(), CONFIG);

    expect(first).toEqual(second);
  });

  it('combines the signals into a bounded score', () => {
    const result = service.score(input(), CONFIG);

    expect(result.combinedScore).toBeGreaterThan(0);
    expect(result.combinedScore).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('reports every signal it used', () => {
    const result = service.score(input({ imageSimilarity: 0.8 }), CONFIG);

    expect(result.signals.text).toBeCloseTo(0.9, 4);
    expect(result.signals.image).toBeCloseTo(0.8, 4);
    expect(result.signals.geographic).toBeGreaterThan(0);
    expect(result.signals.category).toBe(1);
    expect(result.signals.temporal).toBeGreaterThan(0);
  });

  /**
   * The central correctness property of the whole scorer.
   *
   * A missing image signal must redistribute its weight, not contribute zero.
   * Scoring it zero would penalise every text-only report for a capability the
   * platform does not have — "we did not look" read as "we looked and found
   * nothing alike".
   */
  it('renormalises around an unavailable image signal instead of scoring it zero', () => {
    const withoutImage = service.score(input({ imageSimilarity: null }), CONFIG);
    const withZeroImage = service.score(input({ imageSimilarity: 0 }), CONFIG);

    expect(withoutImage.combinedScore).toBeGreaterThan(withZeroImage.combinedScore);
    expect(withoutImage.signals.image).toBeNull();

    // With image weight removed, the remaining weights must still sum to 1 —
    // verified by scoring a pair where every available signal is exactly 1.
    const allOnes = service.score(
      input({
        textSimilarity: 1,
        imageSimilarity: null,
        distanceMeters: 0,
        ageGapDays: 0,
      }),
      CONFIG,
    );
    expect(allOnes.combinedScore).toBe(1);
  });

  it('renormalises around an unknown location too', () => {
    const result = service.score(
      input({ textSimilarity: 1, distanceMeters: null, ageGapDays: 0 }),
      CONFIG,
    );

    expect(result.signals.geographic).toBeNull();
    expect(result.combinedScore).toBe(1);
  });

  // Coverage: a score resting on fewer signals is a weaker claim, and the
  // number the UI shows should say so.
  it('lowers confidence when signals are unavailable', () => {
    const complete = service.score(
      input({ textSimilarity: 1, imageSimilarity: 1, distanceMeters: 0, ageGapDays: 0 }),
      CONFIG,
    );
    const partial = service.score(
      input({ textSimilarity: 1, imageSimilarity: null, distanceMeters: 0, ageGapDays: 0 }),
      CONFIG,
    );

    expect(complete.combinedScore).toBe(partial.combinedScore);
    expect(partial.confidence).toBeLessThan(complete.confidence);
  });

  // Agreement: an average of 0.95 and 0.10 looks like a moderate match, when
  // in truth the evidence is in conflict.
  it('lowers confidence when the signals disagree', () => {
    const agreeing = service.score(
      input({ textSimilarity: 0.7, distanceMeters: 750, ageGapDays: 120 }),
      CONFIG,
    );
    const conflicting = service.score(
      input({
        textSimilarity: 0.98,
        distanceMeters: 4000,
        category: 'POTHOLES',
        candidateCategory: 'STREETLIGHTS',
        ageGapDays: 0,
      }),
      CONFIG,
    );

    expect(conflicting.confidence).toBeLessThan(agreeing.confidence);
  });

  it('scores two reports of the same problem as a likely duplicate', () => {
    const result = service.score(
      input({ textSimilarity: 0.92, distanceMeters: 40, ageGapDays: 2 }),
      CONFIG,
    );

    expect(result.combinedScore).toBeGreaterThanOrEqual(CONFIG.highThreshold);
    expect(result.verdict).toBe('LIKELY_DUPLICATE');
  });

  /**
   * The headline case from the product brief, and the reason the proximity
   * gate exists: a plain weighted average scores this pair 0.66 — a "possible
   * duplicate" — because strong text similarity outvotes a near-zero
   * geographic signal. Two identically-worded potholes 500 km apart are two
   * potholes.
   */
  it('does not flag identical text reported far away', () => {
    const result = service.score(
      input({ textSimilarity: 0.99, distanceMeters: 500_000, ageGapDays: 1 }),
      CONFIG,
    );

    expect(result.signals.geographic).toBeLessThan(0.01);
    expect(result.combinedScore).toBeLessThan(CONFIG.relatedThreshold);
    expect(result.verdict).toBeNull();
  });

  it('suppresses a score smoothly as the pair moves apart', () => {
    const scoreAt = (meters: number) =>
      service.score(input({ textSimilarity: 0.95, distanceMeters: meters }), CONFIG)
        .combinedScore;

    // Within the radius the gate is fully open; beyond it, it closes.
    expect(scoreAt(50)).toBeGreaterThan(CONFIG.highThreshold);
    expect(scoreAt(750)).toBeGreaterThan(scoreAt(1500));
    expect(scoreAt(1500)).toBeGreaterThan(scoreAt(3000));
    expect(scoreAt(3000)).toBeLessThan(CONFIG.relatedThreshold);
  });

  it('does not gate on a location it never measured', () => {
    const result = service.score(
      input({ textSimilarity: 1, distanceMeters: null, ageGapDays: 0 }),
      CONFIG,
    );

    expect(service.proximityGate(null, CONFIG)).toBe(1);
    expect(result.combinedScore).toBe(1);
  });

  /**
   * The category gate's reason for existing. In a dense market area, geography
   * and recency both score near 1 for *every* pair, which is enough to push an
   * unrelated one over the related threshold on those two signals alone.
   */
  it('does not flag a nearby recent report in an unrelated category', () => {
    const result = service.score(
      input({
        textSimilarity: 0.5,
        distanceMeters: 30,
        ageGapDays: 1,
        category: 'POTHOLES',
        candidateCategory: 'STREETLIGHTS',
      }),
      CONFIG,
    );

    expect(result.signals.category).toBe(0.1);
    expect(result.verdict).toBeNull();
  });

  it('still matches across genuinely related categories', () => {
    const result = service.score(
      input({
        textSimilarity: 0.78,
        distanceMeters: 200,
        ageGapDays: 1,
        category: 'POTHOLES',
        candidateCategory: 'ROADS',
      }),
      CONFIG,
    );

    // 0.9 affinity clears the 0.4 gate floor untouched.
    expect(service.categoryGate(result.signals.category, CONFIG)).toBe(1);
    expect(result.verdict).toBe('LIKELY_DUPLICATE');
  });

  it('leaves every pairing in the affinity table above the gate floor', () => {
    const pairs: Array<[string, string]> = [
      ['ROADS', 'POTHOLES'],
      ['DRAINAGE', 'WATER'],
      ['GARBAGE', 'SANITATION'],
      ['STREETLIGHTS', 'ELECTRICITY'],
      ['TRAFFIC', 'ROADS'],
      ['PUBLIC_SAFETY', 'DRAINAGE'],
      ['POLLUTION', 'GARBAGE'],
      ['OTHER', 'POTHOLES'],
    ];

    for (const [left, right] of pairs) {
      const similarity = service.categorySimilarity(left as never, right as never);
      expect(service.categoryGate(similarity, CONFIG)).toBe(1);
    }
  });

  // Category is the smallest weight precisely so it cannot decide a pair.
  it('never lets a category match alone clear a threshold', () => {
    const result = service.score(
      input({
        textSimilarity: 0.05,
        distanceMeters: 4500,
        ageGapDays: 900,
        category: 'POTHOLES',
        candidateCategory: 'POTHOLES',
      }),
      CONFIG,
    );

    expect(result.signals.category).toBe(1);
    expect(result.verdict).toBeNull();
  });

  it('rounds every stored number to the database precision', () => {
    const result = service.score(input({ textSimilarity: 0.123456789 }), CONFIG);
    const decimals = (value: number) => (value.toString().split('.')[1] ?? '').length;

    expect(decimals(result.signals.text!)).toBeLessThanOrEqual(4);
    expect(decimals(result.combinedScore)).toBeLessThanOrEqual(4);
    expect(decimals(result.confidence)).toBeLessThanOrEqual(4);
  });

  it('responds to reconfigured weights', () => {
    const geoHeavy = { ...CONFIG, weights: { ...CONFIG.weights, geographic: 10 } };

    const near = service.score(input({ distanceMeters: 10 }), geoHeavy);
    const far = service.score(input({ distanceMeters: 3000 }), geoHeavy);

    expect(near.combinedScore - far.combinedScore).toBeGreaterThan(0.5);
  });
});

describe('verdict', () => {
  it('maps scores onto the configured bands', () => {
    expect(service.verdict(0.9, CONFIG)).toBe('LIKELY_DUPLICATE');
    expect(service.verdict(0.85, CONFIG)).toBe('LIKELY_DUPLICATE');
    expect(service.verdict(0.7, CONFIG)).toBe('POSSIBLE_DUPLICATE');
    expect(service.verdict(0.65, CONFIG)).toBe('POSSIBLE_DUPLICATE');
    expect(service.verdict(0.55, CONFIG)).toBe('RELATED');
    expect(service.verdict(0.5, CONFIG)).toBe('RELATED');
  });

  it('returns null below the related threshold', () => {
    expect(service.verdict(0.49, CONFIG)).toBeNull();
    expect(service.verdict(0, CONFIG)).toBeNull();
  });

  it('follows reconfigured thresholds', () => {
    const strict = { ...CONFIG, highThreshold: 0.95 };

    expect(service.verdict(0.9, strict)).toBe('POSSIBLE_DUPLICATE');
  });
});

describe('evidence', () => {
  it('explains a strong match in checkable facts', () => {
    const result = service.score(
      input({ textSimilarity: 0.92, distanceMeters: 40, ageGapDays: 2 }),
      CONFIG,
    );
    const ids = result.evidence.map((entry) => entry.id);

    expect(ids).toContain('text-strong');
    expect(ids).toContain('category');
    expect(ids).toContain('geo-close');
    expect(ids).toContain('recent');
  });

  /**
   * Evidence is for a citizen to verify, not a window into a model. Nothing
   * here may read as "the AI thinks…".
   */
  it('states facts rather than model reasoning', () => {
    const result = service.score(
      input({ textSimilarity: 0.92, distanceMeters: 40 }),
      CONFIG,
    );

    for (const entry of result.evidence) {
      expect(entry.label).not.toMatch(/\b(AI|model|score|vector|embedding|because)\b/i);
    }
  });

  it('says nothing when the pair is not worth showing', () => {
    const result = service.score(
      input({ textSimilarity: 0.05, distanceMeters: 4500, ageGapDays: 900 }),
      CONFIG,
    );

    expect(result.verdict).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it('never claims image evidence when no image signal exists', () => {
    const result = service.score(input({ imageSimilarity: null }), CONFIG);

    expect(result.evidence.map((entry) => entry.id)).not.toContain('image');
  });
});
