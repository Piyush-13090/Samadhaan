'use client';

import { useState } from 'react';
import {
  ANALYTICS_PRESETS,
  PRIORITY_TIERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  type AnalyticsPreset,
} from '@samadhaan/shared';
import { NativeSelect } from '@/components/project/native-select';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  ANALYTICS_TIMEZONES,
  PRESET_LABEL,
  humanise,
  type AnalyticsQuery,
} from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';

/** Period presets and the filters. Filters narrow; they never widen scope. */
export function PeriodTabs({
  value,
  onChange,
}: {
  value: AnalyticsPreset;
  onChange: (preset: AnalyticsPreset) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Period"
      className="inline-flex flex-wrap rounded-control border border-border bg-surface p-0.5"
    >
      {ANALYTICS_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          role="tab"
          aria-selected={value === preset}
          onClick={() => onChange(preset)}
          className={cn(
            'rounded-[6px] px-3 py-1.5 type-body-sm',
            value === preset
              ? 'bg-primary-soft font-medium text-primary'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {PRESET_LABEL[preset]}
        </button>
      ))}
    </div>
  );
}

export function AnalyticsFilters({
  query,
  onChange,
  showProblemFilters = true,
}: {
  query: AnalyticsQuery;
  onChange: (query: AnalyticsQuery) => void;
  showProblemFilters?: boolean;
}) {
  const [text, setText] = useState({ city: query.city ?? '', area: query.area ?? '' });
  const set = (patch: Partial<AnalyticsQuery>) => onChange({ ...query, ...patch });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <PeriodTabs value={query.preset} onChange={(preset) => set({ preset })} />
        {query.preset === 'custom' && (
          <>
            <Field label="From">
              <Input
                type="date"
                value={query.from ?? ''}
                onChange={(e) => set({ from: e.target.value })}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={query.to ?? ''}
                onChange={(e) => set({ to: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label="Time zone">
          <NativeSelect
            value={query.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            {ANALYTICS_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {showProblemFilters && (
        <form
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7"
          onSubmit={(e) => {
            e.preventDefault();
            set({ city: text.city.trim(), area: text.area.trim() });
          }}
        >
          <Field label="Category">
            <NativeSelect
              value={query.category ?? ''}
              onChange={(e) =>
                set({ category: e.target.value as AnalyticsQuery['category'] })
              }
            >
              <option value="">Any category</option>
              {PROBLEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_DISPLAY[c].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Severity">
            <NativeSelect
              value={query.severity ?? ''}
              onChange={(e) =>
                set({ severity: e.target.value as AnalyticsQuery['severity'] })
              }
            >
              <option value="">Any severity</option>
              {PROBLEM_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {humanise(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect
              value={query.status ?? ''}
              onChange={(e) =>
                set({ status: e.target.value as AnalyticsQuery['status'] })
              }
            >
              <option value="">Any status</option>
              {PROBLEM_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                <option key={s} value={s}>
                  {humanise(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Priority">
            <NativeSelect
              value={query.priority ?? ''}
              onChange={(e) =>
                set({ priority: e.target.value as AnalyticsQuery['priority'] })
              }
            >
              <option value="">Any priority</option>
              {PRIORITY_TIERS.map((t) => (
                <option key={t} value={t}>
                  {humanise(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="City">
            <Input
              value={text.city}
              maxLength={100}
              placeholder="Any city"
              onChange={(e) => setText({ ...text, city: e.target.value })}
            />
          </Field>
          <Field label="Postal code">
            <Input
              value={text.area}
              maxLength={20}
              placeholder="Any area"
              onChange={(e) => setText({ ...text, area: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" size="md">
              Apply
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
