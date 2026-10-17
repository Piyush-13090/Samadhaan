import type { OrganizationType, ProblemCategory, ProblemSeverity, ProblemStatus, ProblemUrgency } from './problem.js';
import type { PriorityTier } from './priority.js';

/**
 * Advanced search and discovery (Prompt 25).
 *
 * One normalised result shape for every entity, with highlights as plain
 * segments (the client renders `<mark>` itself — no HTML crosses the wire),
 * and a short explanation of why a result ranked where it did.
 */

export const SEARCH_ENTITY_TYPES = ['PROBLEM', 'ORGANIZATION', 'KNOWLEDGE', 'PROJECT'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export const PROBLEM_SEARCH_SORTS = [
  'relevance',
  'newest',
  'oldest',
  'priority',
  'severity',
  'supported',
  'nearest',
] as const;
export type ProblemSearchSort = (typeof PROBLEM_SEARCH_SORTS)[number];

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 200;
export const SEARCH_PAGE_LIMIT_DEFAULT = 20;
export const SEARCH_PAGE_LIMIT_MAX = 50;
export const SEARCH_MAX_RADIUS_KM = 50;

/** A run of text, marked when it matched the query. Render as text, never HTML. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

export interface SearchHighlight {
  field: string;
  segments: HighlightSegment[];
}

interface SearchResultBase {
  type: SearchEntityType;
  /** A public identifier: problem publicId, organisation slug, source or project id. */
  id: string;
  title: string;
  subtitle: string | null;
  /** Where the result opens. Every link is to a page that re-checks access. */
  href: string;
  /** 0–1, comparable within one result list only. */
  score: number;
  highlights: SearchHighlight[];
  /** Plain-language reasons, strongest first ("Matches your words", "Near you"). */
  explanation: string[];
}

export interface ProblemSearchResult extends SearchResultBase {
  type: 'PROBLEM';
  metadata: {
    category: ProblemCategory;
    subcategory: string | null;
    status: ProblemStatus;
    severity: ProblemSeverity;
    urgency: ProblemUrgency;
    priority: PriorityTier | null;
    city: string | null;
    state: string | null;
    voteCount: number;
    createdAt: string;
    /** Rounded to 0.1 km; never coordinates. */
    distanceKm: number | null;
  };
}

export interface OrganizationSearchResult extends SearchResultBase {
  type: 'ORGANIZATION';
  metadata: {
    organizationType: OrganizationType;
    verified: boolean;
    city: string | null;
    state: string | null;
    expertise: ProblemCategory[];
    logoUrl: string | null;
  };
}

export interface KnowledgeSearchResult extends SearchResultBase {
  type: 'KNOWLEDGE';
  metadata: {
    sourceId: string;
    sourceType: string;
    sectionTitle: string | null;
    pageNumber: number | null;
    visibility: string;
  };
}

export interface ProjectSearchResult extends SearchResultBase {
  type: 'PROJECT';
  metadata: {
    status: string;
    problemPublicId: string;
    problemTitle: string;
    organizationName: string;
    governmentName: string;
  };
}

export type SearchResult =
  | ProblemSearchResult
  | OrganizationSearchResult
  | KnowledgeSearchResult
  | ProjectSearchResult;

/** What the query-understanding layer read from the text. */
export interface SearchUnderstanding {
  intent: 'SEARCH_PROBLEMS' | 'SEARCH_ORGANIZATIONS' | 'SEARCH_KNOWLEDGE' | 'SEARCH_PROJECTS' | 'SEARCH_ALL';
  entityType: SearchEntityType | null;
  /** Filters applied because of words in the query (explicit filters win). */
  applied: Array<{ filter: string; value: string; label: string }>;
  /** The words left for keyword and semantic matching. */
  text: string;
  /** "near me" was asked but no location was given. */
  needsLocation: boolean;
  source: 'none' | 'rules' | 'ai';
  confidence: number;
}

export interface SearchPage<T extends SearchResult = SearchResult> {
  items: T[];
  nextCursor: string | null;
  /** Candidates found (bounded); null when unknown. */
  total: number | null;
  /** exact: words matched · related: only similar-meaning matches · none. */
  match: 'exact' | 'related' | 'none';
  understanding: SearchUnderstanding | null;
  /** Retrieval signals that ran ("keyword", "semantic", "geographic"). */
  signals: string[];
}

export interface UnifiedSearchResponse {
  query: string;
  understanding: SearchUnderstanding | null;
  problems: SearchPage<ProblemSearchResult>;
  organizations: SearchPage<OrganizationSearchResult>;
  knowledge: SearchPage<KnowledgeSearchResult>;
  projects: SearchPage<ProjectSearchResult> | null;
}

export interface SearchSuggestion {
  kind: 'PROBLEM' | 'ORGANIZATION' | 'KNOWLEDGE' | 'CATEGORY' | 'CITY' | 'RECENT';
  label: string;
  /** Where choosing it goes — a result page or a search URL. */
  href: string;
  detail: string | null;
}

export interface SearchSuggestions {
  query: string;
  suggestions: SearchSuggestion[];
}

export interface SearchMetrics {
  days: Array<{
    date: string;
    queries: number;
    zeroResults: number;
    semanticUsed: number;
    aiParsed: number;
    byType: Record<string, number>;
    latency: Record<string, number>;
    filters: Record<string, number>;
  }>;
}
