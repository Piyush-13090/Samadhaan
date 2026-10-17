import type {
  KnowledgeSearchResult,
  OrganizationSearchResult,
  ProblemSearchResult,
  ProjectSearchResult,
  SearchPage,
  SearchSuggestions,
  UnifiedSearchResponse,
} from '@samadhaan/shared';
import { api } from '@/lib/api';

/**
 * Search (Prompt 25). The API applies every access policy; the query only
 * narrows. Each call takes an AbortSignal so a newer search cancels an older
 * one.
 */

type Query = Record<string, string | undefined>;

export function searchAll(
  query: Query,
  signal?: AbortSignal,
): Promise<UnifiedSearchResponse> {
  return api.get('/search', { query, signal });
}

export function searchProblems(
  query: Query,
  signal?: AbortSignal,
): Promise<SearchPage<ProblemSearchResult>> {
  return api.get('/search/problems', { query, signal });
}

export function searchOrganizations(
  query: Query,
  signal?: AbortSignal,
): Promise<SearchPage<OrganizationSearchResult>> {
  return api.get('/search/organizations', { query, signal });
}

export function searchKnowledge(
  query: Query,
  signal?: AbortSignal,
): Promise<SearchPage<KnowledgeSearchResult>> {
  return api.get('/search/knowledge', { query, signal });
}

export function searchProjects(
  query: Query,
  signal?: AbortSignal,
): Promise<SearchPage<ProjectSearchResult>> {
  return api.get('/search/projects', { query, signal });
}

export function fetchSuggestions(
  q: string,
  signal?: AbortSignal,
): Promise<SearchSuggestions> {
  return api.get('/search/suggest', { query: { q }, signal });
}

export function fetchRecentSearches(signal?: AbortSignal): Promise<{ items: string[] }> {
  return api.get('/search/recent', { signal });
}

export function clearRecentSearches(): Promise<void> {
  return api.delete('/search/recent');
}
