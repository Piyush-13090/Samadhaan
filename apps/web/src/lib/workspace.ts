import type {
  RelevanceReason,
  WorkspaceOrganizationType,
  WorkspaceProblemSort,
} from '@samadhaan/shared';

/**
 * Vocabulary and paths for the organisation workspace.
 *
 * Paths are built here, from the slug, so no component hand-assembles a
 * workspace URL — and the slug is only ever an address. Whether the viewer may
 * open it is decided by the API on every request.
 */

export const WORKSPACE_SECTIONS = [
  'dashboard',
  'problems',
  'opportunities',
  'allocations',
  'team',
  'profile',
  'settings',
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export function workspacePath(
  slug: string,
  section: WorkspaceSection = 'dashboard',
): string {
  return `/organization/${encodeURIComponent(slug)}/${section}`;
}

/**
 * The workspace slug in a pathname, or `null` outside a workspace.
 * `/organization` itself (the chooser) is not inside one.
 */
export function workspaceSlugFromPath(pathname: string): string | null {
  const match = /^\/organization\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export const ORGANIZATION_TYPE_LABEL: Record<WorkspaceOrganizationType, string> = {
  NGO: 'NGO',
  UNIVERSITY: 'University',
  INDUSTRY: 'Industry',
};

/**
 * Why a problem appears, in words a member can check against their own
 * profile. Deliberately factual — "matches your area of work", never "a good
 * match" — because this is filtering, not the AI matching engine.
 */
export const RELEVANCE_REASON_LABEL: Record<RelevanceReason, string> = {
  EXPERTISE_MATCH: 'Your area of work',
  SUBCATEGORY_MATCH: 'Your specialism',
  IN_SERVICE_AREA: 'In your service area',
  SAME_CITY: 'In your city',
};

export const WORKSPACE_SORT_LABEL: Record<WorkspaceProblemSort, string> = {
  relevance: 'Most relevant',
  recent: 'Newest',
  severity: 'Most severe',
  supported: 'Most supported',
  distance: 'Nearest to you',
};

/** Remembers the last workspace for the shell's links outside one. */
export const LAST_WORKSPACE_STORAGE_KEY = 'samadhaan:last-workspace';
