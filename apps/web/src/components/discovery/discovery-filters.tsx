'use client';

import {
  DISTANCE_OPTIONS,
  PROBLEM_CATEGORIES,
  type DiscoverySort,
  type ProblemCategory,
  type ProblemStatus,
} from '@samadhaan/shared';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY, PROBLEM_STATUS_DISPLAY } from '@/lib/domain-display';
import { formatDistance } from '@/lib/format';

/** Statuses worth filtering by. The rest are internal outcomes, not choices. */
const FILTERABLE_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
  'RESOLVED',
] as const satisfies readonly ProblemStatus[];

/**
 * Orderings a citizen can choose. Each names exactly what it sorts by — no
 * option implies a judgement the system is not making. "Nearest" needs a
 * device location, so it is offered only when there is one.
 */
const SORT_OPTIONS: ReadonlyArray<{
  value: DiscoverySort;
  label: string;
  needsDevice?: true;
}> = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'distance', label: 'Nearest', needsDevice: true },
  { value: 'recent', label: 'Newest' },
  { value: 'severity', label: 'Most severe' },
  { value: 'supported', label: 'Most supported' },
  { value: 'discussed', label: 'Recently discussed' },
];

/**
 * Basic discovery filters: category, distance, status and order.
 *
 * Selects rather than a chip rail. Fifteen categories as chips wrap to three
 * rows on a phone and push the feed below the fold, and this is a filter bar,
 * not the content.
 *
 * Deliberately not a search engine — full-text and semantic search are a later
 * milestone. These three narrow a feed; they do not query one.
 */
export function DiscoveryFilters({
  category,
  status,
  radiusMeters,
  showDistance,
  sort,
  onCategoryChange,
  onStatusChange,
  onRadiusChange,
  onSortChange,
  className,
}: {
  category: ProblemCategory | 'ALL';
  status: ProblemStatus | 'ALL';
  radiusMeters: number;
  /** Hidden for a city search, where a radius means nothing. */
  showDistance: boolean;
  onCategoryChange: (value: ProblemCategory | 'ALL') => void;
  onStatusChange: (value: ProblemStatus | 'ALL') => void;
  onRadiusChange: (value: number) => void;
  /** Omit both to hide the order control. */
  sort?: DiscoverySort;
  onSortChange?: (value: DiscoverySort) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Filter problems"
      className={cn(
        'grid gap-3 sm:grid-cols-2',
        sort && onSortChange ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
        className,
      )}
    >
      <Field label="Category">
        <Select
          value={category}
          onValueChange={(value) => onCategoryChange(value as ProblemCategory | 'ALL')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {PROBLEM_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {CATEGORY_DISPLAY[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {showDistance && (
        <Field label="Distance">
          <Select
            value={String(radiusMeters)}
            onValueChange={(value) => onRadiusChange(Number(value))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISTANCE_OPTIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Within {formatDistance(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label="Status">
        <Select
          value={status}
          onValueChange={(value) => onStatusChange(value as ProblemStatus | 'ALL')}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Active problems</SelectItem>
            {FILTERABLE_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {PROBLEM_STATUS_DISPLAY[value].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {sort && onSortChange && (
        <Field label="Order">
          <Select
            value={sort}
            onValueChange={(value) => onSortChange(value as DiscoverySort)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.filter((option) => !option.needsDevice || showDistance).map(
                (option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}
