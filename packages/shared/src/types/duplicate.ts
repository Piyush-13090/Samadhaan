import type {
  DuplicateStatus,
  ProblemCategory,
  ProblemStatus,
} from './problem.js';
import type { AnalysisProcessingStatus } from './analysis.js';

/**
 * Duplicate-detection contracts shared by the API and the web app.
 *
 * Raw vectors never appear here, and that is deliberate: an embedding is a
 * reconstructable representation of its source text, and publishing the corpus
 * would let anyone probe the similarity space offline. The client receives
 * scores and evidence — enough to explain a match, not enough to reproduce it.
 */

// `DuplicateStatus` and `DUPLICATE_STATUSES` are declared in `problem.js`
// alongside the other Prisma enum mirrors, and re-exported here so a consumer
// of the duplicate contracts gets the whole vocabulary from one import.
export type { DuplicateStatus } from './problem.js';
export { DUPLICATE_STATUSES } from './problem.js';

/**
 * How strongly a pair is being claimed, derived from the combined score.
 *
 * Separate from `DuplicateStatus`, which records what a *person* decided.
 * Conflating them is how an algorithm's opinion turns into a record of human
 * judgement.
 */
export const DUPLICATE_VERDICTS = [
  'LIKELY_DUPLICATE',
  'POSSIBLE_DUPLICATE',
  'RELATED',
] as const;

export type DuplicateVerdict = (typeof DUPLICATE_VERDICTS)[number];

/**
 * The individual signals behind a score.
 *
 * `null` means the signal was unavailable, not zero — the distinction matters,
 * because a missing signal is renormalised away while a zero would actively
 * drag the combined score down.
 */
export interface DuplicateSignals {
  /** Cosine similarity of the two problems' text embeddings. */
  text: number | null;
  /** Cosine similarity of image embeddings. Always null today. */
  image: number | null;
  /** Derived from metres apart, scaled by a configured radius. */
  geographic: number | null;
  /** 1 for an exact category match, lower for a related one. */
  category: number;
  /** Decays with the gap between the two reports, with a floor. */
  temporal: number;
}

/**
 * A short, human-readable reason the pair was flagged.
 *
 * Evidence, not reasoning: "Reported 120 m away" is a fact a citizen can check.
 * The model's internal justification is neither requested nor shown.
 */
export interface DuplicateEvidence {
  id: string;
  label: string;
}

/** One candidate match, as shown to a citizen. */
export interface SimilarProblemView {
  /** Identifies the stored pair, for confirm/reject actions. */
  candidateId: string;

  /** The problem that may already describe this issue. */
  problem: {
    publicId: string;
    title: string;
    category: ProblemCategory;
    subcategory: string | null;
    status: ProblemStatus;
    city: string | null;
    createdAt: string;
    voteCount: number;
    thumbnailUrl: string | null;
  };

  /** 0–1. The weighted combination of the available signals. */
  similarity: number;
  /** 0–1. How much weight the available signals carry between them. */
  confidence: number;
  /** Straight-line metres between the two reports. Null if either lacks coordinates. */
  distanceMeters: number | null;

  verdict: DuplicateVerdict;
  status: DuplicateStatus;
  signals: DuplicateSignals;
  evidence: DuplicateEvidence[];
}

/**
 * The duplicate check for one problem.
 *
 * There is no dedicated `DUPLICATE_CHECK_*` column: the check is a job like any
 * other AI job, so its state is the state of its `ProblemAiAnalysis` row
 * (`analysisType = DUPLICATE_ANALYSIS`). One lifecycle table, one set of
 * semantics, and the recovery sweep that reclaims interrupted analyses already
 * covers it. See docs/ML_DUPLICATE_DETECTION.md.
 */
export interface DuplicateCheckView {
  status: AnalysisProcessingStatus;
  /** Ranked most similar first. Empty when nothing cleared the threshold. */
  candidates: SimilarProblemView[];
  /** How many problems the vector search actually compared. */
  comparedCount: number;
  /** Operator-facing failure reason. Null unless `status` is FAILED. */
  errorMessage: string | null;
  checkedAt: string | null;
}

/** How to describe a similarity score to a person. */
export function duplicateVerdictLabel(verdict: DuplicateVerdict): {
  title: string;
  tone: 'warning' | 'info';
} {
  if (verdict === 'LIKELY_DUPLICATE') {
    return { title: 'Likely the same problem', tone: 'warning' };
  }
  if (verdict === 'POSSIBLE_DUPLICATE') {
    return { title: 'Possibly the same problem', tone: 'warning' };
  }
  return { title: 'Related problem nearby', tone: 'info' };
}

/** Human-readable distance. Metres below a kilometre, then one decimal. */
export function formatDistance(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}
