import { cache } from 'react';
import type {
  InvitableMemberRole,
  MyOrganizations,
  OrganizationDashboard,
  OrganizationMemberRole,
  OrganizationMemberSummary,
  OrganizationProblemPage,
  OrganizationWorkspace,
  ProblemCategory,
  ProblemSeverity,
  ReportedWithinDays,
  WorkspaceProblemScope,
  WorkspaceProblemSort,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Organisation workspace calls.
 *
 * Nothing here sends an organisation id or a user id to decide access. Reads
 * address the workspace by slug and the API resolves the caller's membership
 * from the session; the id-based mutation endpoints re-check that membership
 * on every call.
 */

const EMPTY: MyOrganizations = { workspaces: [], invitations: [] };

function serverOptions(cookieHeader: string) {
  return {
    cache: 'no-store' as const,
    headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
  };
}

/**
 * The caller's workspaces and invitations, for the shell and the chooser.
 * Never throws: a shell that cannot list workspaces still renders. Cached per
 * render, so the layout and the chooser page share one request.
 */
export const fetchMyOrganizationsOnServer = cache(
  async (cookieHeader: string): Promise<MyOrganizations> => {
    try {
      return await createServerApi().get<MyOrganizations>(
        '/organizations/mine',
        serverOptions(cookieHeader),
      );
    } catch {
      return EMPTY;
    }
  },
);

export function fetchMyOrganizations(): Promise<MyOrganizations> {
  return api.get<MyOrganizations>('/organizations/mine', { cache: 'no-store' });
}

export type WorkspaceResult =
  | { kind: 'ok'; workspace: OrganizationWorkspace }
  | { kind: 'not-found' }
  | { kind: 'suspended'; message: string }
  | { kind: 'error'; reference?: string };

/**
 * The workspace for a slug, as the layout and its pages need it.
 *
 * Wrapped in React `cache` so the layout and the page of one render share a
 * single request. 404 and 403 are expected outcomes — "not yours" and
 * "suspended" — and come back as values for the page to render.
 */
export const fetchWorkspaceOnServer = cache(
  async (slug: string, cookieHeader: string): Promise<WorkspaceResult> => {
    try {
      const workspace = await createServerApi().get<OrganizationWorkspace>(
        `/organizations/${encodeURIComponent(slug)}/workspace`,
        serverOptions(cookieHeader),
      );
      return { kind: 'ok', workspace };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { kind: 'not-found' };
      if (error instanceof ApiError && error.status === 403) {
        return { kind: 'suspended', message: error.message };
      }
      return {
        kind: 'error',
        reference: error instanceof ApiError ? error.requestId : undefined,
      };
    }
  },
);

export async function fetchWorkspaceDashboardOnServer(
  slug: string,
  cookieHeader: string,
): Promise<OrganizationDashboard | null> {
  try {
    return await createServerApi().get<OrganizationDashboard>(
      `/organizations/${encodeURIComponent(slug)}/dashboard`,
      serverOptions(cookieHeader),
    );
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export async function fetchMembersOnServer(
  organizationId: string,
  cookieHeader: string,
): Promise<OrganizationMemberSummary[] | null> {
  try {
    return await createServerApi().get<OrganizationMemberSummary[]>(
      `/organizations/${organizationId}/members`,
      serverOptions(cookieHeader),
    );
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

// --- Problem discovery -------------------------------------------------------

export interface WorkspaceProblemsQuery {
  scope?: WorkspaceProblemScope;
  sort?: WorkspaceProblemSort;
  category?: ProblemCategory;
  subcategory?: string;
  severity?: ProblemSeverity;
  status?: string;
  city?: string;
  radiusMeters?: number;
  reportedWithinDays?: ReportedWithinDays;
  page?: number;
  limit?: number;
}

export function toWorkspaceQueryString(query: WorkspaceProblemsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function fetchWorkspaceProblems(
  slug: string,
  query: WorkspaceProblemsQuery,
  signal?: AbortSignal,
): Promise<OrganizationProblemPage> {
  return api.get<OrganizationProblemPage>(
    `/organizations/${encodeURIComponent(slug)}/problems${toWorkspaceQueryString(query)}`,
    { cache: 'no-store', signal },
  );
}

// --- Team ------------------------------------------------------------------

export function inviteMember(
  organizationId: string,
  input: { email: string; membershipRole: InvitableMemberRole },
): Promise<OrganizationMemberSummary> {
  return api.post<OrganizationMemberSummary>(
    `/organizations/${organizationId}/invitations`,
    input,
  );
}

export function changeMemberRole(
  organizationId: string,
  membershipId: string,
  membershipRole: OrganizationMemberRole,
): Promise<OrganizationMemberSummary> {
  return api.patch<OrganizationMemberSummary>(
    `/organizations/${organizationId}/members/${membershipId}`,
    { membershipRole },
  );
}

export function removeMember(
  organizationId: string,
  membershipId: string,
): Promise<void> {
  return api.delete<void>(`/organizations/${organizationId}/members/${membershipId}`);
}

export function respondToInvitation(
  membershipId: string,
  response: 'accept' | 'decline',
): Promise<void> {
  return api.post<void>(`/organizations/invitations/${membershipId}/${response}`);
}
