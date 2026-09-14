import type {
  CitizenDashboard,
  DiscoverySort,
  PaginatedData,
  ProblemCategory,
  ProblemFeed,
  ProblemListItem,
  ProblemStatus,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Citizen dashboard and problem discovery.
 *
 * Two endpoints, not six. The dashboard is one server-rendered call; nearby
 * problems are a second call made from the browser, because only the browser
 * knows where the user is.
 */

export interface NearbyQuery {
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  city?: string;
  category?: ProblemCategory;
  status?: ProblemStatus;
  sort?: DiscoverySort;
  limit?: number;
  cursor?: string;
}

/** Builds the query string, omitting anything unset. */
function toSearchParams(query: NearbyQuery): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

/** Problems near a point, or across a city. Public — no session required. */
export function fetchNearbyProblems(query: NearbyQuery): Promise<ProblemFeed> {
  return api.get<ProblemFeed>(`/problems/nearby${toSearchParams(query)}`, {
    cache: 'no-store',
  });
}

/** The same feed, resolved during server rendering. */
export async function fetchNearbyOnServer(
  query: NearbyQuery,
  cookieHeader: string,
): Promise<ProblemFeed | null> {
  try {
    return await createServerApi().get<ProblemFeed>(
      `/problems/nearby${toSearchParams(query)}`,
      {
        cache: 'no-store',
        headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
      },
    );
  } catch (error) {
    // A discovery feed that cannot load is a section-level failure, not a page
    // one — the caller renders an error state around it.
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export interface MyProblemsQuery {
  status?: ProblemStatus;
  category?: ProblemCategory;
  sort?: 'recent' | 'oldest' | 'severity' | 'status';
  limit?: number;
  cursor?: string;
}

/** The signed-in citizen's own reports. */
export function fetchMyProblems(
  query: MyProblemsQuery = {},
): Promise<PaginatedData<ProblemListItem>> {
  return api.get<PaginatedData<ProblemListItem>>(
    `/problems/my${toSearchParams(query as NearbyQuery)}`,
    { cache: 'no-store' },
  );
}

/**
 * The same, during server rendering.
 *
 * Returns `null` rather than throwing when the API is unreachable. A list that
 * cannot load is a section-level failure — the page around it still works, and
 * the list renders its own error state with a way to retry, instead of the
 * whole route falling to an error boundary.
 */
export async function fetchMyProblemsOnServer(
  query: MyProblemsQuery,
  cookieHeader: string,
): Promise<PaginatedData<ProblemListItem> | null> {
  try {
    return await createServerApi().get<PaginatedData<ProblemListItem>>(
      `/problems/my${toSearchParams(query as NearbyQuery)}`,
      {
        cache: 'no-store',
        headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
      },
    );
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

/** Everything the citizen home page needs, in one request. */
export function fetchCitizenDashboardOnServer(
  cookieHeader: string,
): Promise<CitizenDashboard> {
  return createServerApi().get<CitizenDashboard>('/dashboard/citizen', {
    cache: 'no-store',
    headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
  });
}
