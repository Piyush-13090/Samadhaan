import type {
  BadgeView,
  ContributionView,
  ImpactFilter,
  ImpactSummary,
  LeaderboardPage,
  LeaderboardPeriod,
  ProblemCategory,
  ReputationView,
} from '@samadhaan/shared';
import { api } from '@/lib/api';

/**
 * Impact points, reputation, badges and the leaderboard (Prompt 23). Read-only:
 * points are created by the server alone.
 */
export function fetchImpact(
  filter: ImpactFilter = 'all',
  page = 1,
): Promise<ImpactSummary> {
  return api.get<ImpactSummary>('/users/me/impact', {
    cache: 'no-store',
    query: { filter, page },
  });
}

export function fetchReputation(): Promise<ReputationView> {
  return api.get<ReputationView>('/users/me/reputation', { cache: 'no-store' });
}

export function fetchBadges(): Promise<BadgeView[]> {
  return api.get<BadgeView[]>('/users/me/badges', { cache: 'no-store' });
}

export function fetchContributions(
  page = 1,
): Promise<{
  items: ContributionView[];
  page: number;
  totalCount: number;
  totalPages: number;
}> {
  return api.get('/users/me/contributions', { cache: 'no-store', query: { page } });
}

export interface LeaderboardQuery {
  period?: LeaderboardPeriod;
  city?: string;
  state?: string;
  category?: ProblemCategory;
  page?: number;
}

export function fetchLeaderboard(
  query: LeaderboardQuery,
  signal?: AbortSignal,
): Promise<LeaderboardPage> {
  return api.get<LeaderboardPage>('/leaderboard', {
    cache: 'no-store',
    signal,
    query: {
      period: query.period,
      city: query.city || undefined,
      state: query.state || undefined,
      category: query.category,
      page: query.page,
    },
  });
}
