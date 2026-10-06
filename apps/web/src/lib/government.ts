import type {
  AiStatusFilter,
  DuplicateFilter,
  GovernmentActivityEntry,
  JurisdictionType,
} from '@samadhaan/shared';
import { PROBLEM_STATUS_DISPLAY } from './domain-display';

/**
 * Paths and vocabulary for the government portal. As in the organisation
 * workspace, the slug is an address, not a credential: every page asks the
 * API, which checks role, membership and jurisdiction.
 */

export const GOVERNMENT_SECTIONS = ['dashboard', 'problems', 'map'] as const;
export type GovernmentSection = (typeof GOVERNMENT_SECTIONS)[number];

export function governmentPath(
  slug: string,
  section: GovernmentSection = 'dashboard',
): string {
  return `/government/${encodeURIComponent(slug)}/${section}`;
}

export function governmentProblemPath(slug: string, publicId: string): string {
  return `/government/${encodeURIComponent(slug)}/problems/${encodeURIComponent(publicId)}`;
}

export function governmentSlugFromPath(pathname: string): string | null {
  const match = /^\/government\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export const JURISDICTION_TYPE_LABEL: Record<JurisdictionType, string> = {
  MUNICIPAL_CORPORATION: 'Municipal corporation',
  MUNICIPALITY: 'Municipality',
  DISTRICT_ADMINISTRATION: 'District administration',
  URBAN_LOCAL_BODY: 'Urban local body',
  GOVERNMENT_DEPARTMENT: 'Government department',
  PUBLIC_AUTHORITY: 'Public authority',
};

export const AI_STATUS_LABEL: Record<AiStatusFilter, string> = {
  completed: 'Analysed',
  pending: 'Analysis in progress',
  failed: 'Analysis failed',
  none: 'Not analysed',
};

export const DUPLICATE_FILTER_LABEL: Record<DuplicateFilter, string> = {
  possible: 'Possible duplicate',
  confirmed: 'Confirmed duplicate',
  none: 'No duplicate signals',
};

/** What a review button says, by target status. */
export const TRANSITION_ACTION_LABEL: Record<string, string> = {
  UNDER_REVIEW: 'Start review',
  VERIFIED: 'Verify',
  REJECTED: 'Reject',
};

/** "SAM-1023 verified", "Note added to SAM-1028". */
export function describeActivity(entry: GovernmentActivityEntry): string {
  if (entry.kind === 'NOTE_ADDED')
    return `Internal note added to ${entry.problemPublicId}`;
  if (entry.kind === 'DUPLICATE_CONFIRMED') {
    return `${entry.problemPublicId} confirmed as a duplicate`;
  }
  const org = entry.organizationName ?? 'an organisation';
  switch (entry.kind) {
    case 'ALLOCATION_CREATED':
      return `${entry.problemPublicId} allocated to ${org}`;
    case 'ALLOCATION_ACCEPTED':
      return `${org} accepted ${entry.problemPublicId}`;
    case 'ALLOCATION_DECLINED':
      return `${org} declined ${entry.problemPublicId}`;
    case 'ALLOCATION_CANCELLED':
      return `Allocation of ${entry.problemPublicId} to ${org} withdrawn`;
  }
  const to = entry.toStatus
    ? PROBLEM_STATUS_DISPLAY[entry.toStatus].label.toLowerCase()
    : 'updated';
  return entry.toStatus === 'UNDER_REVIEW'
    ? `${entry.problemPublicId} moved to review`
    : `${entry.problemPublicId} ${to}`;
}

export function describeActor(entry: GovernmentActivityEntry): string {
  switch (entry.actor.kind) {
    case 'TEAM':
      return entry.actor.name ?? 'Your team';
    case 'CITIZEN':
      return 'The reporter';
    case 'SYSTEM':
      return 'Samadhaan';
    case 'ORGANIZATION':
      return entry.actor.name ?? 'The organisation';
    default:
      return 'Another office';
  }
}
