import {
  PROBLEM_STATUSES,
  type NotificationType,
  type ProblemStatus,
} from '@samadhaan/shared';

/**
 * The only metadata a notification may carry.
 *
 * Small and navigational: enough to build a link and show a percentage,
 * nothing that would turn a row into a copy of the problem. Every key is
 * optional and every value is checked — on write, so nothing malformed is
 * stored, and again on read, because a JSON column is untrusted input to the
 * code that renders it, whoever wrote it.
 */
export interface NotificationMetadata {
  problemPublicId?: string;
  candidatePublicId?: string;
  commentId?: string;
  /** 0–1. */
  similarity?: number;
  fromStatus?: ProblemStatus;
  toStatus?: ProblemStatus;
  /** Allocation notifications (Prompt 16). */
  allocationId?: string;
  organizationSlug?: string;
  governmentSlug?: string;
  /** Resolution room notifications (Prompt 17). */
  roomId?: string;
}

const PUBLIC_ID = /^SAM-\d{1,10}$/;

const VERIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'RESOLUTION_EVIDENCE_SUBMITTED',
  'RESOLUTION_EVIDENCE_REVIEWED',
  'RESOLUTION_VERIFICATION_REQUESTED',
  'RESOLUTION_MORE_EVIDENCE_REQUESTED',
  'RESOLUTION_APPROVED',
  'RESOLUTION_REJECTED',
]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keeps only allow-listed keys whose values have the expected shape.
 *
 * Unknown keys are dropped rather than rejected: this runs on read as well as
 * write, and an old row with a since-retired key should still render.
 */
export function sanitizeMetadata(raw: unknown): NotificationMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const input = raw as Record<string, unknown>;
  const clean: NotificationMetadata = {};

  if (
    typeof input.problemPublicId === 'string' &&
    PUBLIC_ID.test(input.problemPublicId)
  ) {
    clean.problemPublicId = input.problemPublicId;
  }
  if (
    typeof input.candidatePublicId === 'string' &&
    PUBLIC_ID.test(input.candidatePublicId)
  ) {
    clean.candidatePublicId = input.candidatePublicId;
  }
  if (typeof input.commentId === 'string' && UUID.test(input.commentId)) {
    clean.commentId = input.commentId;
  }
  if (
    typeof input.similarity === 'number' &&
    Number.isFinite(input.similarity) &&
    input.similarity >= 0 &&
    input.similarity <= 1
  ) {
    clean.similarity = Math.round(input.similarity * 1000) / 1000;
  }
  if (isStatus(input.fromStatus)) clean.fromStatus = input.fromStatus;
  if (isStatus(input.toStatus)) clean.toStatus = input.toStatus;
  if (typeof input.roomId === 'string' && UUID.test(input.roomId)) {
    clean.roomId = input.roomId;
  }
  if (typeof input.allocationId === 'string' && UUID.test(input.allocationId)) {
    clean.allocationId = input.allocationId;
  }
  if (typeof input.organizationSlug === 'string' && SLUG.test(input.organizationSlug)) {
    clean.organizationSlug = input.organizationSlug;
  }
  if (typeof input.governmentSlug === 'string' && SLUG.test(input.governmentSlug)) {
    clean.governmentSlug = input.governmentSlug;
  }

  return clean;
}

function isStatus(value: unknown): value is ProblemStatus {
  return (
    typeof value === 'string' && (PROBLEM_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Where opening a notification goes.
 *
 * Built from validated metadata, never stored: a URL column would be a place a
 * bug — or a future, less careful writer — could put an external or
 * `javascript:` link. Every destination is an in-app path, and a notification
 * whose problem reference is missing still lands somewhere useful rather than
 * nowhere.
 */
export function hrefFor(type: NotificationType, metadata: NotificationMetadata): string {
  // Impact (Prompt 23): the person's own impact page.
  if (type === 'IMPACT_POINTS_AWARDED' || type === 'BADGE_EARNED' || type === 'REPUTATION_TIER_REACHED') {
    return '/profile/impact';
  }
  // Resolution verification (Prompt 22): officials open their verification
  // page; the organisation opens its project's evidence.
  if (VERIFICATION_TYPES.has(type)) {
    if (metadata.governmentSlug && metadata.problemPublicId) {
      return `/government/${metadata.governmentSlug}/problems/${metadata.problemPublicId}#verification`;
    }
    if (metadata.roomId) return `/resolution/${metadata.roomId}/project#evidence`;
  }
  if (type.startsWith('PROJECT_') && metadata.roomId) {
    return `/resolution/${metadata.roomId}/project`;
  }
  if (
    (type === 'RESOLUTION_MESSAGE' ||
      type === 'RESOLUTION_MENTION' ||
      type === 'RESOLUTION_ROOM_CLOSED') &&
    metadata.roomId
  ) {
    return `/resolution/${metadata.roomId}`;
  }
  // Allocations open where the recipient acts on them: the organisation's
  // inbox, or the office's review page for the problem.
  if (
    (type === 'ALLOCATION_REQUESTED' || type === 'ALLOCATION_CANCELLED') &&
    metadata.organizationSlug &&
    metadata.allocationId
  ) {
    return `/organization/${metadata.organizationSlug}/allocations/${metadata.allocationId}`;
  }
  if (
    (type === 'ALLOCATION_ACCEPTED' || type === 'ALLOCATION_DECLINED') &&
    metadata.governmentSlug &&
    metadata.problemPublicId
  ) {
    return `/government/${metadata.governmentSlug}/problems/${metadata.problemPublicId}#allocation`;
  }
  if (
    type === 'PRIORITY_ESCALATED' &&
    metadata.governmentSlug &&
    metadata.problemPublicId
  ) {
    return `/government/${metadata.governmentSlug}/problems/${metadata.problemPublicId}#priority`;
  }

  const publicId = metadata.problemPublicId;
  if (!publicId) return '/notifications';

  const problem = `/problems/${publicId}`;

  switch (type) {
    case 'PROBLEM_COMMENTED':
    case 'COMMENT_REPLIED':
      return `${problem}#discussion`;
    case 'POSSIBLE_DUPLICATE_FOUND':
      // The reporter's own page, where the similar-reports panel lets them
      // confirm or dismiss the match.
      return `${problem}#similar`;
    default:
      return problem;
  }
}
