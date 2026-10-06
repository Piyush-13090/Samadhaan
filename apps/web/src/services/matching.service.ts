import type { ProblemMatches, RecommendationPage } from '@samadhaan/shared';
import { api } from '@/lib/api';
import { toWorkspaceQueryString, type WorkspaceProblemsQuery } from './workspace.service';

/**
 * AI organisation matching (Prompt 14). Reads only — no client can write or
 * change a score. Dismissing a recommendation is the one action, and it is
 * checked server-side against the caller's role in that organisation.
 */

export function fetchProblemMatches(
  publicId: string,
  signal?: AbortSignal,
): Promise<ProblemMatches> {
  return api.get<ProblemMatches>(`/problems/${encodeURIComponent(publicId)}/matches`, {
    cache: 'no-store',
    signal,
  });
}

export interface RecommendationsQuery extends WorkspaceProblemsQuery {
  minRelevance?: number;
  view?: 'active' | 'dismissed';
}

export function fetchRecommendations(
  slug: string,
  query: RecommendationsQuery,
  signal?: AbortSignal,
): Promise<RecommendationPage> {
  return api.get<RecommendationPage>(
    `/organizations/${encodeURIComponent(slug)}/recommendations${toWorkspaceQueryString(query)}`,
    { cache: 'no-store', signal },
  );
}

export function setRecommendationDismissed(
  slug: string,
  publicId: string,
  dismissed: boolean,
): Promise<void> {
  return api.post<void>(
    `/organizations/${encodeURIComponent(slug)}/recommendations/${encodeURIComponent(publicId)}/${dismissed ? 'dismiss' : 'restore'}`,
  );
}
