import {
  ORGANIZATION_TYPES,
  PRIORITY_TIERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEARCH_SORTS,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  PROBLEM_URGENCIES,
  type ProblemSearchSort,
  type SearchEntityType,
} from '@samadhaan/shared';

/**
 * Search state lives in the URL (Prompt 25): shareable, survives refresh,
 * works with back/forward. These helpers read and write it. The server
 * validates every parameter again and never trusts them for access.
 */

export type SearchTab = 'ALL' | SearchEntityType;
export const SEARCH_TABS: Array<{ value: SearchTab; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PROBLEM', label: 'Problems' },
  { value: 'ORGANIZATION', label: 'Organisations' },
  { value: 'KNOWLEDGE', label: 'Knowledge' },
  { value: 'PROJECT', label: 'Projects' },
];

export interface SearchState {
  q: string;
  type: SearchTab;
  sort: ProblemSearchSort;
  interpret: boolean;
  category?: string;
  severity?: string;
  urgency?: string;
  priority?: string;
  status?: string;
  verified?: 'true' | 'false';
  resolved?: 'true' | 'false';
  city?: string;
  state?: string;
  postalCode?: string;
  from?: string;
  to?: string;
  radiusKm?: string;
  lat?: string;
  lng?: string;
  organizationType?: string;
  expertise?: string;
}

/** Filters counted on the mobile "Filters (n)" button. */
export const FILTER_FIELDS = [
  'category',
  'severity',
  'urgency',
  'priority',
  'status',
  'verified',
  'resolved',
  'city',
  'state',
  'postalCode',
  'from',
  'to',
  'radiusKm',
  'organizationType',
  'expertise',
] as const;

const ALLOWED: Partial<Record<keyof SearchState, readonly string[]>> = {
  category: PROBLEM_CATEGORIES,
  expertise: PROBLEM_CATEGORIES,
  severity: PROBLEM_SEVERITIES,
  urgency: PROBLEM_URGENCIES,
  priority: PRIORITY_TIERS,
  status: PROBLEM_STATUSES.filter((s) => s !== 'DRAFT'),
  verified: ['true', 'false'],
  resolved: ['true', 'false'],
  organizationType: ORGANIZATION_TYPES,
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readSearchState(params: URLSearchParams): SearchState {
  const tab = params.get('type');
  const sort = params.get('sort');
  const state: SearchState = {
    q: (params.get('q') ?? '').slice(0, 200),
    type: SEARCH_TABS.some((t) => t.value === tab) ? (tab as SearchTab) : 'ALL',
    sort: (PROBLEM_SEARCH_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as ProblemSearchSort)
      : 'relevance',
    interpret: params.get('interpret') !== 'false',
  };
  for (const field of FILTER_FIELDS) {
    const value = params.get(field)?.trim();
    if (!value) continue;
    const allowed = ALLOWED[field];
    if (allowed && !allowed.includes(value)) continue;
    if ((field === 'from' || field === 'to') && !DATE.test(value)) continue;
    (state as unknown as Record<string, string>)[field] = value.slice(0, 100);
  }
  for (const field of ['lat', 'lng'] as const) {
    const value = params.get(field);
    if (value && Number.isFinite(Number(value))) state[field] = value;
  }
  return state;
}

export function searchQueryString(state: Partial<SearchState>): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type && state.type !== 'ALL') params.set('type', state.type);
  if (state.sort && state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.interpret === false) params.set('interpret', 'false');
  for (const field of [...FILTER_FIELDS, 'lat', 'lng'] as const) {
    const value = state[field];
    if (value) params.set(field, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function activeFilterCount(state: SearchState): number {
  return FILTER_FIELDS.filter((f) => state[f]).length + (state.lat ? 1 : 0);
}

/** Sorts that make sense here: nearest needs a place, relevance needs words. */
export function sortOptions(
  state: SearchState,
): Array<{ value: ProblemSearchSort; label: string }> {
  const all: Array<{ value: ProblemSearchSort; label: string }> = [
    { value: 'relevance', label: state.q ? 'Relevance' : 'Default' },
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'priority', label: 'Highest priority' },
    { value: 'severity', label: 'Highest severity' },
    { value: 'supported', label: 'Most supported' },
    { value: 'nearest', label: 'Nearest' },
  ];
  return all.filter((o) => o.value !== 'nearest' || (state.lat && state.lng));
}

/** API query for the current state and tab. */
export function apiQuery(state: SearchState): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    q: state.q || undefined,
    interpret: state.interpret ? undefined : 'false',
  };
  const pick = (fields: readonly (keyof SearchState)[]) => {
    for (const f of fields) {
      const v = state[f];
      if (typeof v === 'string' && v) out[f] = v;
    }
  };
  if (state.type === 'ORGANIZATION') {
    pick(['organizationType', 'expertise', 'city', 'state']);
  } else if (state.type === 'KNOWLEDGE') {
    pick(['category']);
  } else if (state.type === 'PROJECT') {
    // Projects take only text.
  } else {
    pick([
      ...FILTER_FIELDS.filter((f) => f !== 'organizationType' && f !== 'expertise'),
      'lat',
      'lng',
    ]);
    if (state.sort !== 'relevance') out.sort = state.sort;
    if (state.type === 'ALL' && state.organizationType)
      out.organizationType = state.organizationType;
  }
  return out;
}

export const human = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
