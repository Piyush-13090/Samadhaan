import type {
  AnalyticsAreas,
  AnalyticsCategories,
  AnalyticsCommunity,
  AnalyticsExportDataset,
  AnalyticsHotspots,
  AnalyticsInsightView,
  AnalyticsOverview,
  AnalyticsRecurring,
  AnalyticsResolution,
  AnalyticsTrends,
  CitizenAnalytics,
  OrganizationAnalytics,
} from '@samadhaan/shared';
import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { toAnalyticsQuery, type AnalyticsQuery } from '@/lib/analytics';

/**
 * Civic analytics (Prompt 24). Every call is scoped on the server — the
 * office's jurisdiction, the organisation's membership, the signed-in user.
 * The query only narrows within that.
 */

const gov = (slug: string) => `/government/${encodeURIComponent(slug)}/analytics`;

export interface GovernmentAnalyticsSections {
  overview: AnalyticsOverview;
  trends: AnalyticsTrends;
  categories: AnalyticsCategories;
  areas: AnalyticsAreas;
  resolution: AnalyticsResolution;
  community: AnalyticsCommunity;
  hotspots: AnalyticsHotspots;
  recurring: AnalyticsRecurring;
}
export type GovernmentAnalyticsSection = keyof GovernmentAnalyticsSections;

export function fetchGovernmentAnalytics<K extends GovernmentAnalyticsSection>(
  slug: string,
  section: K,
  query: AnalyticsQuery,
  signal?: AbortSignal,
): Promise<GovernmentAnalyticsSections[K]> {
  return api.get<GovernmentAnalyticsSections[K]>(`${gov(slug)}/${section}`, {
    query: toAnalyticsQuery(query),
    signal,
  });
}

export function fetchLatestInsight(
  slug: string,
  query: AnalyticsQuery,
  signal?: AbortSignal,
): Promise<{ insight: AnalyticsInsightView | null }> {
  return api.get(`${gov(slug)}/insights`, { query: toAnalyticsQuery(query), signal });
}

export function generateInsight(
  slug: string,
  query: AnalyticsQuery,
): Promise<{ insight: AnalyticsInsightView }> {
  return api.post(`${gov(slug)}/insights`, undefined, { query: toAnalyticsQuery(query) });
}

/** A download link: the browser sends the session cookie; the API audits it. */
export function analyticsExportUrl(
  slug: string,
  query: AnalyticsQuery,
  dataset: AnalyticsExportDataset,
  format: 'csv' | 'json',
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...toAnalyticsQuery(query),
    dataset,
    format,
  })) {
    if (value !== undefined) params.set(key, String(value));
  }
  const path = `/api/v1${gov(slug)}/export?${params.toString()}`;
  return env.apiUrl ? new URL(path, env.apiUrl).toString() : path;
}

export function fetchOrganizationAnalytics(
  slug: string,
  query: Pick<AnalyticsQuery, 'preset' | 'from' | 'to' | 'timezone'>,
  signal?: AbortSignal,
): Promise<OrganizationAnalytics> {
  return api.get(`/organizations/${encodeURIComponent(slug)}/analytics`, {
    query: toAnalyticsQuery(query),
    signal,
  });
}

export function fetchMyAnalytics(signal?: AbortSignal): Promise<CitizenAnalytics> {
  return api.get('/users/me/analytics', { signal });
}
