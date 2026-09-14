'use client';

import {
  DISTANCE_OPTIONS,
  PROBLEM_CATEGORIES,
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
 * Basic discovery filters: category, distance and status.
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
  onCategoryChange,
  onStatusChange,
  onRadiusChange,
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
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Filter problems"
      className={cn('grid gap-3 sm:grid-cols-3', className)}
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
    </div>
  );
}
