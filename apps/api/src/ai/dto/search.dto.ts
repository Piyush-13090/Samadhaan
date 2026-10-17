import {
  ORGANIZATION_TYPES,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  SEARCH_ENTITY_TYPES,
  type OrganizationType,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
  type SearchEntityType,
} from '@samadhaan/shared';

/**
 * AI query understanding (Prompt 25) — a fallback for ambiguous
 * natural-language searches. The model returns enum-bounded filters, never
 * SQL; every value is re-validated here against the real taxonomy, and
 * anything unknown is dropped.
 */

export const SEARCH_TIME_RANGES = [
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
  'this_year',
] as const;
export type SearchTimeRange = (typeof SEARCH_TIME_RANGES)[number];

export interface AiSearchUnderstanding {
  entityType: SearchEntityType | null;
  category: ProblemCategory | null;
  severity: ProblemSeverity | null;
  status: ProblemStatus | null;
  /** Free text from the model; accepted only if it names a known city. */
  city: string | null;
  organizationType: OrganizationType | null;
  timeRange: SearchTimeRange | null;
  semanticQuery: string | null;
  confidence: number;
  aiRan: boolean;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;

export function parseSearchUnderstanding(body: unknown): AiSearchUnderstanding | null {
  if (!isObject(body)) return null;
  const filters = isObject(body.filters) ? body.filters : {};
  const confidence = typeof body.confidence === 'number' ? body.confidence : NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (typeof body.ai_ran !== 'boolean') return null;
  const semantic =
    typeof body.semantic_query === 'string' && body.semantic_query.trim()
      ? body.semantic_query.trim().slice(0, 200)
      : null;
  const city =
    typeof filters.city === 'string' && filters.city.trim()
      ? filters.city.trim().slice(0, 100)
      : null;
  return {
    entityType: oneOf(body.entity_type, SEARCH_ENTITY_TYPES),
    category: oneOf(filters.category, PROBLEM_CATEGORIES),
    severity: oneOf(filters.severity, PROBLEM_SEVERITIES),
    status: oneOf(
      filters.status,
      PROBLEM_STATUSES.filter((s) => s !== 'DRAFT'),
    ),
    city,
    organizationType: oneOf(filters.organization_type, ORGANIZATION_TYPES),
    timeRange: oneOf(filters.time_range, SEARCH_TIME_RANGES),
    semanticQuery: semantic,
    confidence,
    aiRan: body.ai_ran,
  };
}
