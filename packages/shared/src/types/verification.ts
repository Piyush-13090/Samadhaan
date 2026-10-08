import type { ProblemCategory, ProblemStatus } from './problem.js';

/**
 * AI-assisted resolution verification (Prompt 22).
 *
 * The assigned organisation submits completion evidence; the AI reviews it
 * and offers an **advisory** recommendation from a vocabulary that has no
 * "resolved"; the allocating government office inspects the evidence and
 * decides. Only that decision resolves a problem.
 */

export const EVIDENCE_TYPES = [
  'BEFORE_AFTER_IMAGE',
  'AFTER_IMAGE',
  'VIDEO',
  'DOCUMENT',
  'LOCATION_PROOF',
  'PROGRESS_UPDATE',
  'OTHER',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'AI_REVIEWED',
  'NEEDS_MORE_EVIDENCE',
  'UNDER_GOVERNMENT_REVIEW',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/**
 * Every allowed evidence status change. Nothing outside this table can
 * happen, and no endpoint accepts a status from a client.
 *
 *   DRAFT ─submit▶ SUBMITTED ─job▶ PROCESSING ─▶ AI_REVIEWED
 *   AI_REVIEWED / NEEDS_MORE_EVIDENCE ─request verification▶ UNDER_GOVERNMENT_REVIEW
 *   UNDER_GOVERNMENT_REVIEW ─government▶ APPROVED / REJECTED / NEEDS_MORE_EVIDENCE
 *   DRAFT / SUBMITTED / AI_REVIEWED / NEEDS_MORE_EVIDENCE ─organisation▶ WITHDRAWN
 *
 * Re-running the AI review later changes the evidence's AI status only, never
 * this lifecycle — evidence under government review stays under review.
 */
export const EVIDENCE_TRANSITIONS: Readonly<Record<EvidenceStatus, readonly EvidenceStatus[]>> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['PROCESSING', 'WITHDRAWN'],
  // Back to SUBMITTED when an attempt fails and will be retried.
  PROCESSING: ['AI_REVIEWED', 'SUBMITTED'],
  AI_REVIEWED: ['UNDER_GOVERNMENT_REVIEW', 'WITHDRAWN'],
  NEEDS_MORE_EVIDENCE: ['UNDER_GOVERNMENT_REVIEW', 'WITHDRAWN'],
  UNDER_GOVERNMENT_REVIEW: ['APPROVED', 'REJECTED', 'NEEDS_MORE_EVIDENCE'],
  APPROVED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export function canTransitionEvidence(from: EvidenceStatus, to: EvidenceStatus): boolean {
  return EVIDENCE_TRANSITIONS[from].includes(to);
}

export const EVIDENCE_FILE_ROLES = ['BEFORE', 'AFTER', 'DOCUMENT', 'OTHER'] as const;
export type EvidenceFileRole = (typeof EVIDENCE_FILE_ROLES)[number];

export const VERIFICATION_RECOMMENDATIONS = [
  'INSUFFICIENT_EVIDENCE',
  'POSSIBLY_RESOLVED',
  'LIKELY_RESOLVED',
  'LIKELY_NOT_RESOLVED',
] as const;
export type VerificationRecommendation = (typeof VERIFICATION_RECOMMENDATIONS)[number];

export type VerificationRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'MORE_EVIDENCE_REQUESTED';

export const EVIDENCE_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
] as const;
export type EvidenceUploadType = (typeof EVIDENCE_UPLOAD_TYPES)[number];

export const EVIDENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const EVIDENCE_FILES_MAX = 8;
export const EVIDENCE_TITLE_MAX = 200;
export const EVIDENCE_DESCRIPTION_MAX = 4000;
export const VERIFICATION_REASON_MIN = 10;
export const VERIFICATION_REASON_MAX = 2000;

/** Shown wherever an AI review is shown. */
export const VERIFICATION_LIMITATIONS = [
  'AI assists verification but does not prove that a real-world problem has been permanently fixed.',
  'It cannot judge structural durability, long-term maintenance, hidden defects or service quality.',
  'It cannot tell whether work happened outside the evidence, or whether evidence is fraudulent.',
  'Photo time and location come from file metadata, which can be edited.',
  'A government official’s inspection and decision are authoritative.',
] as const;

// ---------------------------------------------------------------------------
// Expected evidence, by category
// ---------------------------------------------------------------------------

export type ExpectedEvidenceKind = 'BEFORE_IMAGE' | 'AFTER_IMAGE' | 'LOCATION' | 'DOCUMENT';

export interface ExpectedEvidence {
  kind: ExpectedEvidenceKind;
  label: string;
  /** Expected for this category. Optional items are suggestions, never blockers. */
  required: boolean;
}

const AFTER: ExpectedEvidence = { kind: 'AFTER_IMAGE', label: 'After photo', required: true };
const BEFORE: ExpectedEvidence = { kind: 'BEFORE_IMAGE', label: 'Before photo', required: false };
const LOCATION: ExpectedEvidence = {
  kind: 'LOCATION',
  label: 'Location proof (photo GPS near the reported place)',
  required: false,
};
const doc = (label: string, required = false): ExpectedEvidence => ({
  kind: 'DOCUMENT',
  label,
  required,
});

/**
 * What a reviewer would usually expect, per category. A checklist, not a
 * gate: nothing here blocks a decision, and only the after photo is expected
 * everywhere. Edit here to change it (one definition for API and UI).
 */
export const EXPECTED_EVIDENCE: Record<ProblemCategory, readonly ExpectedEvidence[]> = {
  ROADS: [AFTER, BEFORE, LOCATION, doc('Completion document')],
  POTHOLES: [AFTER, BEFORE, LOCATION, doc('Completion document')],
  STREETLIGHTS: [AFTER, LOCATION],
  WATER: [AFTER, LOCATION, doc('Inspection or water-quality report')],
  DRAINAGE: [AFTER, BEFORE, LOCATION, doc('Inspection evidence')],
  SANITATION: [AFTER, BEFORE, LOCATION],
  GARBAGE: [AFTER, BEFORE, LOCATION],
  TRAFFIC: [AFTER, LOCATION],
  PUBLIC_SAFETY: [AFTER, LOCATION, doc('Inspection evidence')],
  POLLUTION: [AFTER, doc('Inspection or measurement report')],
  ELECTRICITY: [AFTER, LOCATION, doc('Electrical safety certificate')],
  PUBLIC_TRANSPORT: [AFTER],
  PARKS: [AFTER, BEFORE],
  PUBLIC_INFRASTRUCTURE: [AFTER, BEFORE, LOCATION, doc('Completion document')],
  OTHER: [AFTER],
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface EvidenceFileView {
  id: string;
  role: EvidenceFileRole;
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** SHA-256 of the upload — file identity, not authenticity. */
  checksum: string;
  /** Served by the API after an access check. */
  url: string;
  width: number | null;
  height: number | null;
  /** From file metadata (editable): a signal, never proof. */
  capturedAt: string | null;
  /** Distance of the photo's GPS from the reported location. Raw GPS is never exposed. */
  locationDistanceM: number | null;
  createdAt: string;
}

export interface VerificationSignalView {
  key:
    | 'relevance'
    | 'visualConsistency'
    | 'completionSignals'
    | 'locationConsistency'
    | 'documentation'
    | 'temporalConsistency'
    | 'completeness'
    | 'imageQuality';
  label: string;
  /** 0–1, or null when unavailable. */
  value: number | null;
  confidence: number;
  source: string;
}

export interface EvidenceConcern {
  code:
    | 'DUPLICATE_FILE_OTHER_PROBLEM'
    | 'NEAR_DUPLICATE_OTHER_PROBLEM'
    | 'AFTER_MATCHES_BEFORE'
    | 'CAPTURED_BEFORE_REPORT'
    | 'CAPTURED_IN_FUTURE'
    | 'LOCATION_FAR'
    | 'DUPLICATE_UPLOAD'
    | 'CONFLICTING_ASSESSMENTS';
  /** A potential concern for a person to check — never an accusation. */
  text: string;
}

export interface MissingEvidenceItem extends ExpectedEvidence {
  satisfied: boolean;
  /** What satisfied it, in words. */
  satisfiedBy: string | null;
}

export interface VerificationObservation {
  text: string;
  /** F1… are this evidence's files (in order), B1… the original report photos, G1… guidance. */
  refs: string[];
}

export interface VerificationGuidance {
  title: string;
  sectionTitle: string | null;
  href: string;
}

export interface VerificationAssessmentView {
  id: string;
  /** COMPLETED · UNAVAILABLE (no model ran) · FAILED */
  status: string;
  /** After the documented guard rules. Null when no AI review ran. */
  recommendation: VerificationRecommendation | null;
  /** What the model itself said. */
  aiRecommendation: VerificationRecommendation | null;
  confidence: number | null;
  /** 0–100. Never the decision. */
  evidenceQuality: number | null;
  signals: VerificationSignalView[];
  supporting: VerificationObservation[];
  remainingIssues: VerificationObservation[];
  /** Why the recommendation differs from the model's, if it does. */
  adjustments: string[];
  concerns: EvidenceConcern[];
  missingEvidence: MissingEvidenceItem[];
  guidance: VerificationGuidance[];
  model: {
    name: string;
    version: string;
    promptVersion: string | null;
    verificationVersion: string;
  } | null;
  failureMessage: string | null;
  createdAt: string;
}

export interface EvidenceView {
  id: string;
  evidenceType: EvidenceType;
  title: string;
  description: string | null;
  status: EvidenceStatus;
  version: number;
  replacesEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  submittedBy: { name: string };
  submittedAt: string | null;
  createdAt: string;
  /** The government's reason, when it rejected or asked for more. */
  decisionReason: string | null;
  /** PENDING · PROCESSING · COMPLETED · FAILED · UNAVAILABLE */
  aiStatus: string | null;
  files: EvidenceFileView[];
  assessment: VerificationAssessmentView | null;
  permissions: {
    canUpload: boolean;
    canSubmit: boolean;
    canWithdraw: boolean;
    canAnalyze: boolean;
  };
}

export interface VerificationRequestView {
  id: string;
  status: VerificationRequestStatus;
  note: string | null;
  requestedBy: string;
  governmentName: string;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  decisionNote: string | null;
  evidenceCount: number;
}

export interface VerificationTimelineEntry {
  id: string;
  action: string;
  text: string;
  actor: { name: string | null; side: 'ORGANIZATION' | 'GOVERNMENT' | 'SYSTEM' };
  createdAt: string;
}

/** Recommendation across the evidence under review — the latest, with conflicts flagged. */
export interface VerificationRollup {
  recommendation: VerificationRecommendation | null;
  confidence: number | null;
  evidenceQuality: number | null;
  conflicting: boolean;
  concerns: EvidenceConcern[];
}

/** `GET /resolution-projects/:id/verification` — both sides of the project. */
export interface ProjectVerificationView {
  evidence: EvidenceView[];
  request: VerificationRequestView | null;
  history: VerificationRequestView[];
  missingEvidence: MissingEvidenceItem[];
  timeline: VerificationTimelineEntry[];
  canSubmitEvidence: boolean;
  canRequestVerification: boolean;
  /** Why verification cannot be requested yet, if it cannot. */
  requestBlockers: string[];
  problemStatus: ProblemStatus;
  limitations: readonly string[];
}

/** `GET /government/:slug/problems/:publicId/verification` */
export interface GovernmentVerificationView {
  problem: {
    publicId: string;
    title: string;
    description: string;
    category: ProblemCategory;
    status: ProblemStatus;
    reportedAt: string;
    resolvedAt: string | null;
    beforeImages: Array<{ url: string }>;
  };
  project: {
    id: string;
    roomId: string;
    name: string;
    status: string;
    organizationName: string;
    taskProgress: number;
    openTasks: number;
    completedTasks: number;
    milestones: Array<{ title: string; completed: boolean; dueDate: string | null }>;
  } | null;
  evidence: EvidenceView[];
  request: VerificationRequestView | null;
  history: VerificationRequestView[];
  rollup: VerificationRollup;
  missingEvidence: MissingEvidenceItem[];
  timeline: VerificationTimelineEntry[];
  /** True for the allocating office while a request is pending. */
  canDecide: boolean;
  /** Reasons approval is not possible now (e.g. open tasks). Reject / request more stay available. */
  approvalBlockers: string[];
  limitations: readonly string[];
}

/** Public facts about a verified resolution, on the citizen problem page. */
export interface PublicResolution {
  resolvedAt: string;
  verifiedBy: string;
}
