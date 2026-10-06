import type {
  AllocationCandidate,
  AllocationView,
  GovernmentAllocationView,
  OrganizationAllocationDetail,
  OrganizationAllocationPage,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Government allocation calls (Prompt 16).
 *
 * Nothing here says who is acting or for which office: the API derives the
 * official, the allocating office and the responding member from the session
 * and the slug. The only organisation id sent is the one the official chose —
 * and the API re-checks that it is eligible.
 */

const gov = (slug: string) => `/government/${encodeURIComponent(slug)}`;
const org = (slug: string) => `/organizations/${encodeURIComponent(slug)}`;

// --- Government --------------------------------------------------------------

export function searchAllocationCandidates(
  slug: string,
  publicId: string,
  q: string,
  signal?: AbortSignal,
): Promise<AllocationCandidate[]> {
  return api.get<AllocationCandidate[]>(
    `${gov(slug)}/problems/${encodeURIComponent(publicId)}/allocation-candidates?q=${encodeURIComponent(q)}`,
    { cache: 'no-store', signal },
  );
}

export function createAllocation(
  slug: string,
  publicId: string,
  input: { organizationId: string; instructions?: string; internalReason?: string },
): Promise<GovernmentAllocationView> {
  return api.post<GovernmentAllocationView>(
    `${gov(slug)}/problems/${encodeURIComponent(publicId)}/allocations`,
    input,
  );
}

export function cancelAllocation(
  slug: string,
  allocationId: string,
  reason?: string,
): Promise<GovernmentAllocationView> {
  return api.post<GovernmentAllocationView>(
    `${gov(slug)}/allocations/${encodeURIComponent(allocationId)}/cancel`,
    reason ? { reason } : {},
  );
}

// --- Organisation ------------------------------------------------------------

function serverOptions(cookieHeader: string) {
  return {
    cache: 'no-store' as const,
    headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
  };
}

export type AllocationResult<T> =
  { kind: 'ok'; data: T } | { kind: 'not-found' } | { kind: 'error'; reference?: string };

async function serverGet<T>(
  path: string,
  cookieHeader: string,
): Promise<AllocationResult<T>> {
  try {
    return {
      kind: 'ok',
      data: await createServerApi().get<T>(path, serverOptions(cookieHeader)),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'not-found' };
    return {
      kind: 'error',
      reference: error instanceof ApiError ? error.requestId : undefined,
    };
  }
}

export function fetchAllocationsOnServer(
  slug: string,
  query: { view: AllocationView; page: number },
  cookieHeader: string,
) {
  return serverGet<OrganizationAllocationPage>(
    `${org(slug)}/allocations?view=${query.view}&page=${query.page}`,
    cookieHeader,
  );
}

export function fetchAllocationOnServer(slug: string, id: string, cookieHeader: string) {
  return serverGet<OrganizationAllocationDetail>(
    `${org(slug)}/allocations/${encodeURIComponent(id)}`,
    cookieHeader,
  );
}

export function acceptAllocation(
  slug: string,
  id: string,
  note?: string,
): Promise<OrganizationAllocationDetail> {
  return api.post<OrganizationAllocationDetail>(
    `${org(slug)}/allocations/${encodeURIComponent(id)}/accept`,
    note ? { note } : {},
  );
}

export function declineAllocation(
  slug: string,
  id: string,
  reason: string,
): Promise<OrganizationAllocationDetail> {
  return api.post<OrganizationAllocationDetail>(
    `${org(slug)}/allocations/${encodeURIComponent(id)}/decline`,
    { reason },
  );
}
