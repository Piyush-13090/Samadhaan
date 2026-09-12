import type { HealthReport } from '@samadhaan/shared';
import { createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Feature services own the API paths for one domain. Components call these
 * rather than the raw client, so a route change is a one-line edit here.
 */

export type HealthQueryResult =
  { reachable: true; report: HealthReport } | { reachable: false; message: string };

/**
 * Fetches system health from the server side.
 *
 * The API being unreachable is an expected state that the status page renders,
 * not an exception it should crash on — so it is returned as data.
 */
export async function fetchSystemHealth(): Promise<HealthQueryResult> {
  try {
    const report = await createServerApi().get<HealthReport>('/health', {
      // Health is live state; a cached answer would be actively misleading.
      cache: 'no-store',
    });
    return { reachable: true, report };
  } catch (error) {
    return {
      reachable: false,
      message:
        error instanceof ApiError ? error.message : 'Could not reach the Samadhaan API',
    };
  }
}
