import type {
  DuplicateEvidence,
  DuplicateSignals,
  DuplicateVerdict,
  ProblemCategory,
  ProblemStatus,
  SimilarProblemView,
} from '@samadhaan/shared';
import type { DuplicateDetectionConfig } from '../config/app.config.js';
import type {
  Problem,
  ProblemDuplicateCandidate,
  ProblemImage,
} from '../generated/prisma/client.js';

type CandidateRow = ProblemDuplicateCandidate & {
  candidateProblem: Problem & { images: ProblemImage[] };
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Recovers the verdict band from a stored score.
 *
 * Derived rather than stored: thresholds are configuration, so a stored band
 * would go stale the moment an operator retuned them, and the pair would then
 * be described one way and scored another.
 */
function verdictFor(
  score: number,
  config: DuplicateDetectionConfig,
): DuplicateVerdict {
  if (score >= config.highThreshold) return 'LIKELY_DUPLICATE';
  if (score >= config.possibleThreshold) return 'POSSIBLE_DUPLICATE';
  return 'RELATED';
}

/**
 * Rebuilds the evidence list from the stored signals.
 *
 * Recomputed rather than persisted, for the same reason as the verdict, and
 * because evidence is presentation: its wording will change far more often than
 * the numbers behind it, and a stored copy would freeze old phrasing into rows.
 */
function evidenceFor(
  signals: DuplicateSignals,
  sameCategory: boolean,
  distanceMeters: number | null,
  ageGapDays: number,
): DuplicateEvidence[] {
  const evidence: DuplicateEvidence[] = [];

  if ((signals.text ?? 0) >= 0.8) {
    evidence.push({ id: 'text-strong', label: 'Describes a very similar problem' });
  } else if ((signals.text ?? 0) >= 0.55) {
    evidence.push({ id: 'text', label: 'Describes a similar problem' });
  }

  if (sameCategory) {
    evidence.push({ id: 'category', label: 'Same civic category' });
  } else if (signals.category >= 0.5) {
    evidence.push({ id: 'category-related', label: 'Closely related category' });
  }

  if (distanceMeters !== null) {
    if (distanceMeters <= 100) {
      evidence.push({ id: 'geo-close', label: 'Reported at almost the same spot' });
    } else if ((signals.geographic ?? 0) >= 0.5) {
      evidence.push({ id: 'geo', label: 'Reported nearby' });
    }
  }

  if (ageGapDays <= 7) {
    evidence.push({ id: 'recent', label: 'Reported around the same time' });
  }

  if (signals.image !== null && signals.image >= 0.7) {
    evidence.push({ id: 'image', label: 'Photos appear to show the same thing' });
  }

  return evidence;
}

/**
 * Recovers the distance that produced a stored geographic similarity.
 *
 * The inverse of the scorer's half-value decay. Storing the distance directly
 * would be simpler, but the schema from Prompt 4 records signals rather than
 * raw measurements, and inverting a monotonic function is exact enough to show
 * a citizen "350 m away".
 */
function distanceFrom(
  geographicSimilarity: number | null,
  radiusMeters: number,
): number | null {
  if (geographicSimilarity === null || geographicSimilarity <= 0) return null;
  if (geographicSimilarity >= 1) return 0;

  // similarity = 0.5 ** (ratio ** 2)  =>  ratio = sqrt(log2(1 / similarity))
  const ratio = Math.sqrt(Math.log2(1 / geographicSimilarity));
  return Math.round(ratio * radiusMeters);
}

/**
 * Recomputes the temporal signal from the gap between two reports.
 *
 * Must stay in step with `DuplicateScoringService.temporalSimilarity`; a shared
 * spec asserts the two agree, so a change to one without the other fails.
 */
export function temporalFor(
  ageGapDays: number,
  config: DuplicateDetectionConfig,
): number {
  const gap = Math.max(0, ageGapDays);
  const floor = Math.min(1, Math.max(0, config.temporalFloor));
  const decay = 0.5 ** (gap / config.temporalHalfLifeDays);

  return Math.round((floor + (1 - floor) * decay) * 10_000) / 10_000;
}

/**
 * Maps a stored pair onto the response shape.
 *
 * An allow-list, like every other serializer here. Raw vectors are not merely
 * omitted — they are never loaded: an embedding reconstructs its source text
 * well enough that publishing the corpus would let anyone probe the similarity
 * space offline.
 */
export async function toSimilarProblemView(
  row: CandidateRow,
  config: DuplicateDetectionConfig,
  resolveUrl: (key: string) => Promise<string> | string,
): Promise<SimilarProblemView> {
  const signals: DuplicateSignals = {
    text: toNumber(row.textSimilarity),
    image: toNumber(row.imageSimilarity),
    geographic: toNumber(row.geographicSimilarity),
    category: toNumber(row.categorySimilarity) ?? 0,
    // Filled in below: the Prompt 4 schema has no column for it, but it is a
    // pure function of the two timestamps and the configuration, so it is
    // recomputed exactly rather than reported as zero.
    temporal: 0,
  };

  const combinedScore = toNumber(row.combinedScore) ?? 0;
  const distanceMeters = distanceFrom(signals.geographic, config.geoRadiusMeters);
  const ageGapDays = Math.max(
    0,
    (row.createdAt.getTime() - row.candidateProblem.createdAt.getTime()) / 86_400_000,
  );

  signals.temporal = temporalFor(ageGapDays, config);

  const primaryImage = row.candidateProblem.images[0];

  return {
    candidateId: row.id,
    problem: {
      publicId: row.candidateProblem.publicId,
      title: row.candidateProblem.title,
      category: row.candidateProblem.category as ProblemCategory,
      subcategory: row.candidateProblem.subcategory,
      status: row.candidateProblem.status as ProblemStatus,
      city: row.candidateProblem.city,
      createdAt: row.candidateProblem.createdAt.toISOString(),
      voteCount: row.candidateProblem.voteCount,
      thumbnailUrl: primaryImage ? await resolveUrl(primaryImage.storageKey) : null,
    },
    similarity: combinedScore,
    confidence: toNumber(row.confidence) ?? 0,
    distanceMeters,
    verdict: verdictFor(combinedScore, config),
    status: row.status,
    signals,
    // A stored category similarity of 1 means the two categories were
    // identical — the scorer caps every other pairing below it.
    evidence: evidenceFor(signals, signals.category >= 1, distanceMeters, ageGapDays),
  };
}
