import { Injectable } from '@nestjs/common';
import type {
  DuplicateEvidence,
  DuplicateSignals,
  DuplicateVerdict,
  ProblemCategory,
} from '@samadhaan/shared';
import type { DuplicateDetectionConfig } from '../../config/app.config.js';

/**
 * How closely two civic categories describe the same kind of problem.
 *
 * A hand-written domain taxonomy, not a model — and deliberately so. "A pothole
 * report and a roads report may well be the same thing" is knowledge about
 * Indian municipal categories, not a pattern to be learned from data we do not
 * have. It is here, in one table, rather than spread through scoring code.
 *
 * Symmetric: only one direction is listed and both are looked up.
 */
const RELATED_CATEGORIES: ReadonlyArray<
  readonly [ProblemCategory, ProblemCategory, number]
> = [
  // The same physical defect, filed under either heading.
  ['ROADS', 'POTHOLES', 0.9],
  // Standing water is reported as both the water and the drain that failed.
  ['DRAINAGE', 'WATER', 0.75],
  // Uncollected waste and general sanitation overlap almost entirely.
  ['GARBAGE', 'SANITATION', 0.85],
  // An unlit street is an electricity fault to one reporter and a lighting
  // fault to another.
  ['STREETLIGHTS', 'ELECTRICITY', 0.7],
  // Traffic problems are usually road problems with a different emphasis.
  ['TRAFFIC', 'ROADS', 0.6],
  // An open drain is filed under safety as often as under drainage.
  ['PUBLIC_SAFETY', 'DRAINAGE', 0.5],
  ['PUBLIC_SAFETY', 'ROADS', 0.5],
  ['PUBLIC_INFRASTRUCTURE', 'ROADS', 0.5],
  ['PUBLIC_INFRASTRUCTURE', 'PARKS', 0.5],
  ['POLLUTION', 'GARBAGE', 0.5],
  ['SANITATION', 'DRAINAGE', 0.5],
];

const CATEGORY_AFFINITY = new Map<string, number>();
for (const [left, right, score] of RELATED_CATEGORIES) {
  CATEGORY_AFFINITY.set(`${left}|${right}`, score);
  CATEGORY_AFFINITY.set(`${right}|${left}`, score);
}

/**
 * Similarity between two categories that are not the same.
 *
 * `OTHER` is treated as weakly compatible with everything rather than as its
 * own category: it is where a reporter lands when no heading fits, so matching
 * it strictly would hide exactly the reports most likely to be mis-filed.
 */
const UNRELATED_CATEGORY_SIMILARITY = 0.1;
const OTHER_CATEGORY_SIMILARITY = 0.4;

/** Raw inputs to a single pair's score. */
export interface DuplicateScoreInput {
  /** Cosine similarity of text embeddings. */
  textSimilarity: number;
  /** Cosine similarity of image embeddings, or null when unavailable. */
  imageSimilarity: number | null;
  /** Metres between the two reports, or null when either lacks coordinates. */
  distanceMeters: number | null;
  category: ProblemCategory;
  candidateCategory: ProblemCategory;
  subcategory: string | null;
  candidateSubcategory: string | null;
  /** Whole days between the two reports. Never negative. */
  ageGapDays: number;
}

/** The full result of scoring one pair. */
export interface DuplicateScore {
  signals: DuplicateSignals;
  /** 0–1, the renormalised weighted combination of available signals. */
  combinedScore: number;
  /** 0–1, how much to trust that combination. */
  confidence: number;
  verdict: DuplicateVerdict | null;
  evidence: DuplicateEvidence[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Rounds to four decimals — the precision of the database columns. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Combines similarity signals into one score.
 *
 * Pure: the same inputs and the same configuration always produce the same
 * output, with no clock, no randomness and no database access. That is what
 * makes the thresholds testable at all, and it is what lets Prompt 28 swap
 * these hand-chosen weights for learned ones without touching the pipeline
 * around it — a learned model supplies a different `DuplicateDetectionConfig`
 * and everything else is unchanged.
 */
@Injectable()
export class DuplicateScoringService {
  /**
   * Geographic similarity from distance.
   *
   * Half-value decay: exactly 0.5 at the configured radius, 1 at zero distance,
   * and falling away quickly beyond it (0.06 at twice the radius). Chosen over
   * a linear ramp because the interesting region is the first hundred metres —
   * GPS drift and a mis-dropped pin both live there — and a linear function
   * spends most of its range on distances that are already clearly unrelated.
   */
  geographicSimilarity(distanceMeters: number | null, radiusMeters: number): number | null {
    if (distanceMeters === null || !Number.isFinite(distanceMeters)) return null;
    if (radiusMeters <= 0) return null;

    const ratio = Math.max(0, distanceMeters) / radiusMeters;
    return clamp01(0.5 ** (ratio * ratio));
  }

  /**
   * Category similarity.
   *
   * Never 0 for a mismatch, and never the deciding signal on its own: its
   * configured weight is the smallest of the five precisely so that "same
   * category" cannot carry a pair over a threshold by itself.
   */
  categorySimilarity(
    category: ProblemCategory,
    candidateCategory: ProblemCategory,
  ): number {
    // Already the maximum. A matching free-text subcategory is corroboration,
    // but it cannot raise a signal that is capped at 1 — it earns its place in
    // the evidence list instead, where a reader can actually see it.
    if (category === candidateCategory) return 1;

    if (category === 'OTHER' || candidateCategory === 'OTHER') {
      return OTHER_CATEGORY_SIMILARITY;
    }

    return (
      CATEGORY_AFFINITY.get(`${category}|${candidateCategory}`) ??
      UNRELATED_CATEGORY_SIMILARITY
    );
  }

  /**
   * Temporal similarity from the gap between two reports.
   *
   * Exponential decay with a floor. The floor is the important part: a pothole
   * that has gone unrepaired for two years is still the same pothole when
   * somebody reports it again, so age must be able to lower a score without
   * ever making an old problem unmatchable.
   */
  temporalSimilarity(ageGapDays: number, config: DuplicateDetectionConfig): number {
    const gap = Math.max(0, ageGapDays);
    const decay = 0.5 ** (gap / config.temporalHalfLifeDays);
    const floor = clamp01(config.temporalFloor);

    return clamp01(floor + (1 - floor) * decay);
  }

  /** Scores one candidate pair. */
  score(input: DuplicateScoreInput, config: DuplicateDetectionConfig): DuplicateScore {
    const signals: DuplicateSignals = {
      text: clamp01(input.textSimilarity),
      image: input.imageSimilarity === null ? null : clamp01(input.imageSimilarity),
      geographic: this.geographicSimilarity(input.distanceMeters, config.geoRadiusMeters),
      category: clamp01(
        this.categorySimilarity(input.category, input.candidateCategory),
      ),
      temporal: this.temporalSimilarity(input.ageGapDays, config),
    };

    const weighted: Array<{ weight: number; value: number }> = [
      { weight: config.weights.text, value: signals.text ?? 0 },
      { weight: config.weights.category, value: signals.category },
      { weight: config.weights.temporal, value: signals.temporal },
    ];

    // Unavailable signals are *omitted*, never scored 0. Scoring a missing
    // image as zero would penalise every text-only report for a capability the
    // platform does not have — which is the difference between "we did not
    // look" and "we looked and found nothing alike".
    if (signals.image !== null) {
      weighted.push({ weight: config.weights.image, value: signals.image });
    }
    if (signals.geographic !== null) {
      weighted.push({ weight: config.weights.geographic, value: signals.geographic });
    }

    const availableWeight = weighted.reduce((total, entry) => total + entry.weight, 0);
    const totalWeight =
      config.weights.text +
      config.weights.image +
      config.weights.geographic +
      config.weights.category +
      config.weights.temporal;

    // No usable signal at all. Returning 0 rather than dividing by zero.
    if (availableWeight <= 0) {
      return {
        signals,
        combinedScore: 0,
        confidence: 0,
        verdict: null,
        evidence: [],
      };
    }

    const blended = clamp01(
      weighted.reduce((total, entry) => total + entry.weight * entry.value, 0) /
        availableWeight,
    );

    // Both gates apply. Being the same physical problem requires being in the
    // same place *and* being the same kind of thing; either one failing is
    // enough to rule the pair out, however well the other reads.
    const combinedScore = clamp01(
      blended *
        this.proximityGate(signals.geographic, config) *
        this.categoryGate(signals.category, config),
    );

    // Confidence describes the blend — how much evidence there was and how well
    // it agreed. The gate is a separate statement about plausibility, so it
    // must not be laundered into the confidence number as well.
    const confidence = this.confidence(weighted, blended, availableWeight, totalWeight);
    const verdict = this.verdict(combinedScore, config);

    return {
      signals: {
        text: signals.text === null ? null : round4(signals.text),
        image: signals.image === null ? null : round4(signals.image),
        geographic: signals.geographic === null ? null : round4(signals.geographic),
        category: round4(signals.category),
        temporal: round4(signals.temporal),
      },
      combinedScore: round4(combinedScore),
      confidence: round4(confidence),
      verdict,
      evidence: verdict ? this.evidence(signals, input) : [],
    };
  }

  /**
   * Suppresses a score when the two reports are not plausibly co-located.
   *
   * Geography is not merely another signal to average in: two reports describe
   * the same physical pothole only if they are in the same place, so distance
   * can veto in a way that word choice cannot. A plain weighted average cannot
   * express that — identical text 500 km away outvotes a near-zero geographic
   * signal and lands in the "possible duplicate" band, which is nonsense.
   *
   * So the additive blend is multiplied by this factor: 1 once the pair is at
   * least `geoGateFloor` similar in location — roughly within 1.4x the
   * configured radius — and falling linearly to 0 below that.
   *
   * Unknown location does not gate. A signal that was never measured cannot
   * veto; the missing coverage already shows up as lower confidence.
   */
  proximityGate(
    geographicSimilarity: number | null,
    config: DuplicateDetectionConfig,
  ): number {
    if (geographicSimilarity === null) return 1;
    if (config.geoGateFloor <= 0) return 1;

    return clamp01(geographicSimilarity / config.geoGateFloor);
  }

  /**
   * Suppresses a score when the two reports are not about the same kind of
   * problem.
   *
   * The same necessity argument as `proximityGate`, on the other axis. Nearby
   * reports filed within days of each other score highly on geography and time
   * regardless of what they say, and in a dense market area that is enough to
   * drag an unrelated pair over the "related" threshold — a pothole report
   * surfacing a waterlogging report purely because both are in Sector 12.
   *
   * Cross-category matches that are genuinely plausible are unaffected: the
   * affinity table puts ROADS/POTHOLES at 0.9 and the loosest related pairing
   * at 0.5, both comfortably above the floor. Only the 0.1 "unrelated" case is
   * suppressed. Category still carries the smallest additive weight, so this
   * gate can veto a pair but can never carry one.
   */
  categoryGate(categorySimilarity: number, config: DuplicateDetectionConfig): number {
    if (config.categoryGateFloor <= 0) return 1;

    return clamp01(categorySimilarity / config.categoryGateFloor);
  }

  /**
   * How much to trust a combined score.
   *
   * Two independent things reduce it, and they are genuinely different:
   *
   *  - **Coverage** — what fraction of the intended evidence was available. A
   *    score computed without images rests on less than one computed with them,
   *    and saying so is more honest than quietly renormalising and claiming the
   *    same certainty.
   *  - **Agreement** — how much the available signals concur. Text saying 0.95
   *    while geography says 0.10 averages to something middling that looks like
   *    a moderate match, when in truth the evidence is in conflict and the
   *    average is the least informative summary of it.
   */
  private confidence(
    weighted: Array<{ weight: number; value: number }>,
    mean: number,
    availableWeight: number,
    totalWeight: number,
  ): number {
    const coverage = totalWeight > 0 ? clamp01(availableWeight / totalWeight) : 0;

    const deviation =
      weighted.reduce(
        (total, entry) => total + entry.weight * Math.abs(entry.value - mean),
        0,
      ) / availableWeight;

    // Signals live in [0,1], so the weighted mean absolute deviation cannot
    // exceed 0.5; doubling maps full disagreement onto the whole range.
    const agreement = clamp01(1 - 2 * deviation);

    return clamp01(coverage * agreement);
  }

  /** Which band a score falls into, or `null` when it is not worth showing. */
  verdict(
    combinedScore: number,
    config: DuplicateDetectionConfig,
  ): DuplicateVerdict | null {
    if (combinedScore >= config.highThreshold) return 'LIKELY_DUPLICATE';
    if (combinedScore >= config.possibleThreshold) return 'POSSIBLE_DUPLICATE';
    if (combinedScore >= config.relatedThreshold) return 'RELATED';
    return null;
  }

  /**
   * Short, checkable reasons the pair was flagged.
   *
   * Facts a citizen can verify — "reported 120 m away", "same category" — never
   * a narrative about how a model decided. There is no hidden reasoning to
   * expose here, and there must not appear to be.
   */
  private evidence(
    signals: DuplicateSignals,
    input: DuplicateScoreInput,
  ): DuplicateEvidence[] {
    const evidence: DuplicateEvidence[] = [];

    if ((signals.text ?? 0) >= 0.8) {
      evidence.push({ id: 'text-strong', label: 'Describes a very similar problem' });
    } else if ((signals.text ?? 0) >= 0.55) {
      evidence.push({ id: 'text', label: 'Describes a similar problem' });
    }

    if (input.category === input.candidateCategory) {
      evidence.push({ id: 'category', label: 'Same civic category' });
    } else if (signals.category >= 0.5) {
      evidence.push({ id: 'category-related', label: 'Closely related category' });
    }

    if (input.distanceMeters !== null) {
      if (input.distanceMeters <= 100) {
        evidence.push({ id: 'geo-close', label: 'Reported at almost the same spot' });
      } else if ((signals.geographic ?? 0) >= 0.5) {
        evidence.push({ id: 'geo', label: 'Reported nearby' });
      }
    }

    if (input.ageGapDays <= 7) {
      evidence.push({ id: 'recent', label: 'Reported around the same time' });
    }

    if (signals.image !== null && signals.image >= 0.7) {
      evidence.push({ id: 'image', label: 'Photos appear to show the same thing' });
    }

    return evidence;
  }
}
