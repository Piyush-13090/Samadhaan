'use client';

import { SlidersHorizontal } from 'lucide-react';
import {
  GOVERNMENT_STATUS_FILTERS,
  MAP_FILTER_STATUSES,
  type AiStatusFilter,
  type DuplicateFilter,
  PROBLEM_CATEGORIES,
  type MapFilterStatus,
  type ProblemCategory,
  type ProblemSeverity,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  CATEGORY_DISPLAY,
  PROBLEM_STATUS_DISPLAY,
  SEVERITY_DISPLAY,
} from '@/lib/domain-display';
import { SEVERITY_ORDER } from '@/lib/map/severity-markers';
import type { MapFilters } from '@/services/map.service';

const ALL = 'ALL';

/**
 * Category, severity and status filters for the map.
 *
 * Categories come from the shared taxonomy and severities are the stored bands
 * — nothing is invented for the map. Statuses are the five a citizen can act
 * on; drafts, duplicates and internal outcomes are not choices.
 *
 * Inline from `md` up. On a phone the same fields open in a bottom drawer, so
 * three selects do not push the map off the screen.
 */
export function MapFilterBar({
  filters,
  onChange,
  variant = 'public',
  className,
}: {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
  /**
   * `government` adds review filters — every non-draft status, duplicate and
   * AI-analysis state, and how recently reported. Still a handful of fields:
   * the map should stay the subject.
   */
  variant?: 'public' | 'government';
  className?: string;
}) {
  const government = variant === 'government';
  const statuses: readonly string[] = government
    ? GOVERNMENT_STATUS_FILTERS
    : MAP_FILTER_STATUSES;
  const active = [
    filters.category,
    filters.severity,
    filters.status,
    filters.duplicate,
    filters.aiStatus,
    filters.reportedWithinDays,
  ].filter(Boolean).length;

  const fields = (
    <>
      <Field label="Category" className="min-w-0">
        <Select
          value={filters.category ?? ALL}
          onValueChange={(value) =>
            onChange({
              ...filters,
              category: value === ALL ? undefined : (value as ProblemCategory),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {PROBLEM_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {CATEGORY_DISPLAY[category].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Severity" className="min-w-0">
        <Select
          value={filters.severity ?? ALL}
          onValueChange={(value) =>
            onChange({
              ...filters,
              severity: value === ALL ? undefined : (value as ProblemSeverity),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All severities</SelectItem>
            {SEVERITY_ORDER.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {SEVERITY_DISPLAY[severity].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Status" className="min-w-0">
        <Select
          value={filters.status ?? ALL}
          onValueChange={(value) =>
            onChange({
              ...filters,
              status: value === ALL ? undefined : (value as MapFilters['status']),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {government ? 'Open problems' : 'Active problems'}
            </SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {PROBLEM_STATUS_DISPLAY[status as MapFilterStatus].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {government && (
        <>
          <Field label="Duplicates" className="min-w-0">
            <Select
              value={filters.duplicate ?? ALL}
              onValueChange={(value) =>
                onChange({
                  ...filters,
                  duplicate: value === ALL ? undefined : (value as DuplicateFilter),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                <SelectItem value="possible">Possible duplicate</SelectItem>
                <SelectItem value="none">No duplicate signals</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="AI analysis" className="min-w-0">
            <Select
              value={filters.aiStatus ?? ALL}
              onValueChange={(value) =>
                onChange({
                  ...filters,
                  aiStatus: value === ALL ? undefined : (value as AiStatusFilter),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                <SelectItem value="completed">Analysed</SelectItem>
                <SelectItem value="pending">In progress</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="none">Not analysed</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Reported" className="min-w-0">
            <Select
              value={
                filters.reportedWithinDays ? String(filters.reportedWithinDays) : ALL
              }
              onValueChange={(value) =>
                onChange({
                  ...filters,
                  reportedWithinDays:
                    value === ALL ? undefined : (Number(value) as 7 | 30 | 90),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any time</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
    </>
  );

  return (
    <div className={className}>
      <div
        role="group"
        aria-label="Filter the map"
        // Three across even with the review filters: two calm rows beat six
        // cramped columns beside the search box.
        className="hidden gap-3 md:grid md:grid-cols-3"
      >
        {fields}
      </div>

      <div className="flex items-center gap-2 md:hidden">
        <Drawer>
          <DrawerTrigger asChild>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={<SlidersHorizontal />}
              className="h-11"
            >
              Filters{active > 0 ? ` (${active})` : ''}
            </Button>
          </DrawerTrigger>
          <DrawerContent side="bottom" title="Filter the map">
            <div role="group" aria-label="Filter the map" className="grid gap-4 pb-4">
              {fields}
            </div>
          </DrawerContent>
        </Drawer>
        {active > 0 && (
          <Button variant="ghost" size="md" className="h-11" onClick={() => onChange({})}>
            Clear
          </Button>
        )}
      </div>

      {active > 0 && (
        <div className={cn('mt-2 hidden md:block')}>
          <Button variant="link" size="sm" onClick={() => onChange({})}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
