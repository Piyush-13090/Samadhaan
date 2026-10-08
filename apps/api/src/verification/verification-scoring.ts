import {
  EXPECTED_EVIDENCE,
  type EvidenceConcern,
  type EvidenceFileRole,
  type EvidenceType,
  type MissingEvidenceItem,
  type ProblemCategory,
  type VerificationRecommendation,
  type VerificationSignalView,
} from '@samadhaan/shared';

/**
 * Deterministic verification scoring (Prompt 22) — pure and testable.
 *
 * The AI service contributes four signals (relevance, visual consistency,
 * completion signals, documentation) and a recommendation. This module adds
 * the signals that need no model — location and time from file metadata,
 * completeness against the category's expected evidence, image quality —
 * combines them into an evidence-quality score, and applies documented guard
 * rules that can only make the AI's recommendation more cautious, never less.
 */

export const VERIFICATION_VERSION = 'verification-baseline-v1';

/** Evidence-quality weights. A documented starting point, not fitted values. */
export const QUALITY_WEIGHTS: Record<VerificationSignalView['key'], number> = {
  relevance: 0.25,
  completionSignals: 0.25,
  visualConsistency: 0.1,
  locationConsistency: 0.1,
  documentation: 0.1,
  completeness: 0.1,
  temporalConsistency: 0.05,
  imageQuality: 0.05,
};

export const SIGNAL_LABELS: Record<VerificationSignalView['key'], string> = {
  relevance: 'Relevance to the reported issue',
  completionSignals: 'Signs the issue was addressed',
  visualConsistency: 'Before/after consistency',
  locationConsistency: 'Location consistency',
  documentation: 'Documentation',
  completeness: 'Expected evidence present',
  temporalConsistency: 'Time consistency',
  imageQuality: 'Image quality',
};

/** Perceptual hashes this close (of 64 bits) are treated as the same picture. */
export const NEAR_DUPLICATE_BITS = 6;

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export interface Signal {
  value: number | null;
  confidence: number;
  source: string;
}

// ---------------------------------------------------------------- signals

/**
 * Photo GPS against the reported location. The closest photo counts.
 * Confidence is capped at 0.5: EXIF can be edited.
 */
export function locationConsistency(
  distancesM: number[],
  near: number,
  far: number,
): Signal {
  if (distancesM.length === 0) {
    return { value: null, confidence: 0, source: 'No photo carries GPS metadata' };
  }
  const best = Math.min(...distancesM);
  const value = best <= near ? 1 : best >= far ? 0 : 1 - (best - near) / (far - near);
  return {
    value: clamp01(value),
    confidence: 0.5,
    source: `Closest photo GPS ${Math.round(best)} m from the reported location (metadata can be edited)`,
  };
}

/**
 * After-photos should be taken after the problem was reported, and not in the
 * future. A day's tolerance absorbs clock and time-zone drift.
 */
export function temporalConsistency(
  afterCaptures: Date[],
  reportedAt: Date,
  now: Date,
): Signal & { early: number; future: number } {
  if (afterCaptures.length === 0) {
    return {
      value: null,
      confidence: 0,
      source: 'No after-photo carries a capture time',
      early: 0,
      future: 0,
    };
  }
  const day = 86_400_000;
  const early = afterCaptures.filter(
    (d) => d.getTime() < reportedAt.getTime() - day,
  ).length;
  const future = afterCaptures.filter((d) => d.getTime() > now.getTime() + day).length;
  const ok = afterCaptures.length - early - future;
  return {
    value: ok / afterCaptures.length,
    confidence: 0.4,
    source: `${ok} of ${afterCaptures.length} after-photo capture times fall after the report (metadata can be edited)`,
    early,
    future,
  };
}

/** 720 px on the short side is enough to see a repair; less counts proportionally. */
export function imageQuality(
  images: Array<{ width: number | null; height: number | null }>,
): Signal {
  const sized = images.filter((i) => i.width && i.height);
  if (sized.length === 0) return { value: null, confidence: 0, source: 'No images' };
  const mean =
    sized.reduce((sum, i) => sum + Math.min(1, Math.min(i.width!, i.height!) / 720), 0) /
    sized.length;
  return {
    value: clamp01(mean),
    confidence: 0.8,
    source: `${sized.length} image${sized.length === 1 ? '' : 's'}, resolution-based`,
  };
}

// ------------------------------------------------------------- checklist

export interface ChecklistInput {
  category: ProblemCategory;
  /** The problem's own report photos count as "before". */
  reportPhotos: number;
  evidence: Array<{
    evidenceType: EvidenceType;
    files: Array<{
      role: EvidenceFileRole;
      mimeType: string;
      locationDistanceM: number | null;
    }>;
  }>;
  locationNearM: number;
}

/** The category's expected evidence, each marked satisfied or not. */
export function missingEvidence(input: ChecklistInput): MissingEvidenceItem[] {
  const files = input.evidence.flatMap((e) =>
    e.files.map((f) => ({ ...f, type: e.evidenceType })),
  );
  const image = (f: { mimeType: string }) => f.mimeType.startsWith('image/');
  return EXPECTED_EVIDENCE[input.category].map((item) => {
    let satisfiedBy: string | null = null;
    switch (item.kind) {
      case 'AFTER_IMAGE':
        if (
          files.some((f) => image(f) && (f.role === 'AFTER' || f.type === 'AFTER_IMAGE'))
        ) {
          satisfiedBy = 'An after photo was submitted';
        }
        break;
      case 'BEFORE_IMAGE':
        if (files.some((f) => image(f) && f.role === 'BEFORE')) {
          satisfiedBy = 'A before photo was submitted';
        } else if (input.reportPhotos > 0) {
          satisfiedBy = 'The citizen’s original report photo';
        }
        break;
      case 'LOCATION':
        if (
          files.some(
            (f) =>
              f.locationDistanceM !== null && f.locationDistanceM <= input.locationNearM,
          )
        ) {
          satisfiedBy = 'A photo’s GPS is near the reported location';
        } else if (
          input.evidence.some(
            (e) => e.evidenceType === 'LOCATION_PROOF' && e.files.length > 0,
          )
        ) {
          satisfiedBy = 'Location proof was submitted';
        }
        break;
      case 'DOCUMENT':
        if (files.some((f) => f.mimeType === 'application/pdf')) {
          satisfiedBy = 'A document was submitted';
        }
        break;
    }
    return { ...item, satisfied: satisfiedBy !== null, satisfiedBy };
  });
}

/** Required items count fully, suggestions half. */
export function completeness(items: MissingEvidenceItem[]): Signal {
  const weight = (i: MissingEvidenceItem) => (i.required ? 1 : 0.5);
  const total = items.reduce((sum, i) => sum + weight(i), 0);
  if (total === 0)
    return { value: null, confidence: 0, source: 'No expectations for this category' };
  const met = items.filter((i) => i.satisfied).reduce((sum, i) => sum + weight(i), 0);
  return {
    value: met / total,
    confidence: 1,
    source: `${items.filter((i) => i.satisfied).length} of ${items.length} expected items present`,
  };
}

// --------------------------------------------------------------- quality

/** 0–100, confidence-weighted over the available signals. Never the decision. */
export function evidenceQuality(
  signals: Record<VerificationSignalView['key'], Signal>,
): number | null {
  let weighted = 0;
  let total = 0;
  for (const [key, signal] of Object.entries(signals) as Array<
    [VerificationSignalView['key'], Signal]
  >) {
    if (signal.value === null || signal.confidence <= 0) continue;
    const w = QUALITY_WEIGHTS[key] * signal.confidence;
    weighted += w * signal.value;
    total += w;
  }
  return total > 0 ? Number(((weighted / total) * 100).toFixed(2)) : null;
}

// -------------------------------------------------------- recommendation

/** Concerns serious enough that a "likely resolved" needs a human second look. */
const SERIOUS: ReadonlySet<EvidenceConcern['code']> = new Set([
  'AFTER_MATCHES_BEFORE',
  'DUPLICATE_FILE_OTHER_PROBLEM',
  'NEAR_DUPLICATE_OTHER_PROBLEM',
  'CAPTURED_BEFORE_REPORT',
  'LOCATION_FAR',
]);

export interface RecommendationInput {
  ai: VerificationRecommendation | null;
  aiConfidence: number;
  /** At least one evidence photo, or a document the AI could read. */
  analysable: boolean;
  relevance: number | null;
  location: number | null;
  concerns: EvidenceConcern[];
}

/**
 * The AI's recommendation after the guard rules. Each rule can only move it
 * towards caution, and each records why.
 */
export function recommend(input: RecommendationInput): {
  recommendation: VerificationRecommendation | null;
  adjustments: string[];
} {
  if (input.ai === null) return { recommendation: null, adjustments: [] };
  const adjustments: string[] = [];
  let r: VerificationRecommendation = input.ai;

  if (!input.analysable && r !== 'INSUFFICIENT_EVIDENCE') {
    adjustments.push('There is no photo or readable document to assess.');
    r = 'INSUFFICIENT_EVIDENCE';
  }
  if (
    input.relevance !== null &&
    input.relevance < 0.3 &&
    r !== 'INSUFFICIENT_EVIDENCE'
  ) {
    adjustments.push('The evidence appears unrelated to the reported issue.');
    r = 'INSUFFICIENT_EVIDENCE';
  }
  if (input.aiConfidence < 0.4) {
    if (r === 'LIKELY_RESOLVED') {
      adjustments.push('The AI review had low confidence.');
      r = 'POSSIBLY_RESOLVED';
    } else if (r === 'LIKELY_NOT_RESOLVED') {
      adjustments.push('The AI review had low confidence.');
      r = 'INSUFFICIENT_EVIDENCE';
    }
  }
  if (r === 'LIKELY_RESOLVED') {
    if (input.location !== null && input.location < 0.3) {
      adjustments.push('Photo location metadata does not match the reported location.');
      r = 'POSSIBLY_RESOLVED';
    } else if (input.concerns.some((c) => SERIOUS.has(c.code))) {
      adjustments.push('A potential evidence concern needs checking.');
      r = 'POSSIBLY_RESOLVED';
    }
  }
  return { recommendation: r, adjustments };
}

// ------------------------------------------------------------- hashing

/** Bits that differ between two 64-bit perceptual hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let count = 0;
  while (x) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

/**
 * A 64-bit difference hash from a 9×8 greyscale thumbnail (row-major): bit i is
 * set when a pixel is brighter than its right neighbour. Robust to resizing
 * and recompression; not to crops or edits — a near-duplicate signal only.
 */
export function differenceHash(pixels: Uint8Array): bigint {
  if (pixels.length !== 72)
    throw new Error('differenceHash expects a 9×8 greyscale image');
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      hash <<= 1n;
      if (pixels[row * 9 + col]! > pixels[row * 9 + col + 1]!) hash |= 1n;
    }
  }
  return BigInt.asIntN(64, hash); // stored as a signed BIGINT
}

/** Rolls several evidence reviews into one view: the latest, with conflicts flagged. */
export function conflicting(recommendations: VerificationRecommendation[]): boolean {
  return (
    recommendations.includes('LIKELY_RESOLVED') &&
    recommendations.includes('LIKELY_NOT_RESOLVED')
  );
}
