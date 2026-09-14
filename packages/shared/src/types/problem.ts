/**
 * Problem domain vocabulary shared by the API and the web app.
 *
 * These mirror the Prisma enums exactly — the database is the source of truth,
 * and this file is the one place the frontend learns it. Keeping a second,
 * different vocabulary in the UI layer is how a feed ends up rendering statuses
 * the backend never emits.
 */

/**
 * The full lifecycle a report moves through, in progression order.
 *
 * `DUPLICATE` and `REJECTED` are terminal side exits rather than stages;
 * `ARCHIVED` removes a resolved problem from active views without deleting the
 * civic record.
 */
export const PROBLEM_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
  'DUPLICATE',
  'ARCHIVED',
] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** Statuses that represent live work; used to filter active feeds. */
export const ACTIVE_PROBLEM_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
] as const satisfies readonly ProblemStatus[];

export const PROBLEM_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

/**
 * How soon a problem must be dealt with — a different question from severity.
 * A collapsed footpath is severe but not urgent at 3am; a live cable is both.
 */
export const PROBLEM_URGENCIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type ProblemUrgency = (typeof PROBLEM_URGENCIES)[number];

/** Controlled classification taxonomy. Mirrors the `ProblemCategory` enum. */
export const PROBLEM_CATEGORIES = [
  'ROADS',
  'POTHOLES',
  'STREETLIGHTS',
  'WATER',
  'DRAINAGE',
  'SANITATION',
  'GARBAGE',
  'TRAFFIC',
  'PUBLIC_SAFETY',
  'POLLUTION',
  'ELECTRICITY',
  'PUBLIC_TRANSPORT',
  'PARKS',
  'PUBLIC_INFRASTRUCTURE',
  'OTHER',
] as const;

export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

export const ORGANIZATION_TYPES = [
  'NGO',
  'UNIVERSITY',
  'INDUSTRY',
  'GOVERNMENT',
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const VERIFICATION_STATUSES = [
  'PENDING',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** A member's authority within one organisation — distinct from `UserRole`. */
export const ORGANIZATION_MEMBER_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

export type OrganizationMemberRole = (typeof ORGANIZATION_MEMBER_ROLES)[number];

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'LEFT'] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const PROBLEM_IMAGE_KINDS = ['BEFORE', 'PROGRESS', 'AFTER', 'EVIDENCE'] as const;

export type ProblemImageKind = (typeof PROBLEM_IMAGE_KINDS)[number];

export const SUGGESTION_STATUSES = [
  'PENDING',
  'REVIEWED',
  'ACCEPTED',
  'REJECTED',
] as const;

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const DUPLICATE_STATUSES = [
  'PENDING',
  'LIKELY_DUPLICATE',
  'NOT_DUPLICATE',
  'CONFIRMED_DUPLICATE',
  'REJECTED',
] as const;

export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

export const EMBEDDING_TYPES = ['TEXT', 'IMAGE', 'MULTIMODAL'] as const;

export type EmbeddingType = (typeof EMBEDDING_TYPES)[number];

export const ANALYSIS_TYPES = [
  'INITIAL_ANALYSIS',
  'REANALYSIS',
  'DUPLICATE_ANALYSIS',
  'SEVERITY_ANALYSIS',
  'VERIFICATION_ANALYSIS',
] as const;

export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

export const PROCESSING_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/**
 * Dimension of the vectors stored in `problem_embeddings`.
 *
 * Fixed because pgvector can only build an HNSW index on a column of declared
 * width. 384 is the native width of the configured text encoder,
 * `sentence-transformers/all-MiniLM-L6-v2`.
 *
 * Exported so the API can reject a vector of the wrong width *before* it
 * reaches the database, rather than each side hard-coding a number. A model
 * swap is a migration plus a re-embed — see docs/DATABASE.md §6.
 */
export const EMBEDDING_DIMENSIONS = 384;
