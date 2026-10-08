import {
  ANALYTICS_DEFAULT_TIMEZONE,
  METRIC_DEFINITIONS,
  type AnalyticsPreset,
  type PriorityTier,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
} from '@samadhaan/shared';

/** What the dashboard asks for. Every field only narrows the server's scope. */
export interface AnalyticsQuery {
  preset: AnalyticsPreset;
  from?: string;
  to?: string;
  timezone: string;
  category?: ProblemCategory | '';
  severity?: ProblemSeverity | '';
  status?: ProblemStatus | '';
  priority?: PriorityTier | '';
  city?: string;
  area?: string;
}

export const DEFAULT_ANALYTICS_QUERY: AnalyticsQuery = {
  preset: '30d',
  timezone: ANALYTICS_DEFAULT_TIMEZONE,
};

export const PRESET_LABEL: Record<AnalyticsPreset, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  custom: 'Custom',
};

/** Common reporting zones; the API accepts any IANA zone. */
export const ANALYTICS_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
] as const;

export const NOT_ENOUGH_DATA = 'Not enough data yet';
export const NO_COMPARISON = 'Comparison unavailable';

/** Query-string values, dropping empty filters and incomplete custom ranges. */
export function toAnalyticsQuery(
  query: Partial<AnalyticsQuery>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    preset: query.preset,
    timezone: query.timezone,
  };
  if (query.preset === 'custom') {
    out.from = query.from || undefined;
    out.to = query.to || undefined;
  }
  for (const key of [
    'category',
    'severity',
    'status',
    'priority',
    'city',
    'area',
  ] as const) {
    const value = query[key]?.toString().trim();
    if (value) out[key] = value;
  }
  return out;
}

export function isCustomIncomplete(query: AnalyticsQuery): boolean {
  return query.preset === 'custom' && (!query.from || !query.to);
}

export function metricLabel(key: string): string {
  return METRIC_DEFINITIONS[key]?.label ?? key;
}

export function metricDefinition(key: string): string | undefined {
  return METRIC_DEFINITIONS[key]?.definition;
}

const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function formatValue(
  value: number | null | undefined,
  unit?: 'days' | '%',
): string {
  if (value === null || value === undefined) return NOT_ENOUGH_DATA;
  const text = number.format(value);
  if (unit === '%') return `${text}%`;
  if (unit === 'days') return `${text} ${value === 1 ? 'day' : 'days'}`;
  return text;
}

export function formatChange(change: number | null | undefined): string {
  if (change === null || change === undefined) return NO_COMPARISON;
  if (change === 0) return 'No change';
  return `${change > 0 ? '+' : ''}${number.format(change)}% vs previous period`;
}

export function humanise(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}
