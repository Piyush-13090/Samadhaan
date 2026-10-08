import type {
  EvidenceStatus,
  EvidenceType,
  VerificationRecommendation,
  VerificationRequestStatus,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  BEFORE_AFTER_IMAGE: 'Before / after photos',
  AFTER_IMAGE: 'After photos',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  LOCATION_PROOF: 'Location proof',
  PROGRESS_UPDATE: 'Progress update',
  OTHER: 'Other',
};

export const EVIDENCE_STATUS_DISPLAY: Record<
  EvidenceStatus,
  { label: string; tone: Tone }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  PROCESSING: { label: 'AI review running', tone: 'ai' },
  AI_REVIEWED: { label: 'AI reviewed', tone: 'ai' },
  NEEDS_MORE_EVIDENCE: { label: 'More evidence requested', tone: 'warning' },
  UNDER_GOVERNMENT_REVIEW: { label: 'With the government', tone: 'primary' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
};

/** The AI's advisory wording — never "resolved". */
export const RECOMMENDATION_DISPLAY: Record<
  VerificationRecommendation,
  { label: string; tone: Tone }
> = {
  LIKELY_RESOLVED: { label: 'Likely resolved', tone: 'success' },
  POSSIBLY_RESOLVED: { label: 'Possibly resolved', tone: 'info' },
  INSUFFICIENT_EVIDENCE: { label: 'Insufficient evidence', tone: 'warning' },
  LIKELY_NOT_RESOLVED: { label: 'Likely not resolved', tone: 'danger' },
};

export const REQUEST_STATUS_DISPLAY: Record<
  VerificationRequestStatus,
  { label: string; tone: Tone }
> = {
  PENDING: { label: 'Awaiting government decision', tone: 'primary' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  MORE_EVIDENCE_REQUESTED: { label: 'More evidence requested', tone: 'warning' },
};

export const ACCEPTED_EVIDENCE_FILES = '.jpg,.jpeg,.png,.webp,.pdf,.mp4,.mov,.m4v';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
