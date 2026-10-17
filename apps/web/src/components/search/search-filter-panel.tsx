'use client';

import { LocateFixed } from 'lucide-react';
import { useState } from 'react';
import {
  ORGANIZATION_TYPES,
  PRIORITY_TIERS,
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  PROBLEM_STATUSES,
  PROBLEM_URGENCIES,
} from '@samadhaan/shared';
import { NativeSelect } from '@/components/project/native-select';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { FILTER_FIELDS, human, type SearchState } from '@/lib/search';

type Patch = Partial<SearchState>;

function Select({
  label,
  value,
  options,
  onChange,
  any = 'Any',
}: {
  label: string;
  value: string | undefined;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
  any?: string;
}) {
  return (
    <Field label={label}>
      <NativeSelect
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

const enumOptions = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: human(v) }));
const categories = PROBLEM_CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_DISPLAY[c].label,
}));
const yesNo = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

/**
 * Filters for the current tab (Prompt 25). Selects apply immediately; typed
 * fields apply with "Apply". Every value goes to the URL and is validated by
 * the server — filters narrow results, they never grant access.
 */
export function SearchFilterPanel({
  state,
  onChange,
}: {
  state: SearchState;
  onChange: (patch: Patch) => void;
}) {
  const [text, setText] = useState({
    city: state.city ?? '',
    state: state.state ?? '',
    postalCode: state.postalCode ?? '',
    from: state.from ?? '',
    to: state.to ?? '',
  });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const tab = state.type;

  if (tab === 'PROJECT') {
    return (
      <p className="type-body-sm text-ink-muted">
        Projects are searched by name and problem only.
      </p>
    );
  }

  const reset = () => {
    const cleared = Object.fromEntries(
      [...FILTER_FIELDS, 'lat', 'lng'].map((f) => [f, undefined]),
    ) as Patch;
    setText({ city: '', state: '', postalCode: '', from: '', to: '' });
    onChange(cleared);
  };

  const nearMe = () => {
    if (!('geolocation' in navigator)) {
      setLocationError('Your browser cannot share a location.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        // Rounded to ~100 m: enough to search near, not an exact position.
        onChange({
          lat: position.coords.latitude.toFixed(3),
          lng: position.coords.longitude.toFixed(3),
          radiusKm: state.radiusKm ?? '5',
        });
      },
      () => {
        setLocating(false);
        setLocationError('Location was not shared.');
      },
      { maximumAge: 300_000, timeout: 10_000 },
    );
  };

  return (
    <form
      className="space-y-4"
      aria-label="Search filters"
      onSubmit={(e) => {
        e.preventDefault();
        onChange({
          city: text.city.trim() || undefined,
          state: text.state.trim() || undefined,
          postalCode: text.postalCode.trim() || undefined,
          from: text.from || undefined,
          to: text.to || undefined,
        });
      }}
    >
      {tab === 'ORGANIZATION' ? (
        <>
          <Select
            label="Type"
            value={state.organizationType}
            options={enumOptions(ORGANIZATION_TYPES)}
            onChange={(v) => onChange({ organizationType: v })}
          />
          <Select
            label="Verified"
            value={state.verified}
            options={yesNo}
            onChange={(v) => onChange({ verified: v as Patch['verified'] })}
          />
          <Select
            label="Expertise"
            value={state.expertise}
            options={categories}
            onChange={(v) => onChange({ expertise: v })}
          />
        </>
      ) : (
        <Select
          label="Category"
          value={state.category}
          options={categories}
          onChange={(v) => onChange({ category: v })}
        />
      )}

      {(tab === 'ALL' || tab === 'PROBLEM') && (
        <>
          <Select
            label="Severity"
            value={state.severity}
            options={enumOptions(PROBLEM_SEVERITIES)}
            onChange={(v) => onChange({ severity: v })}
          />
          <Select
            label="Urgency"
            value={state.urgency}
            options={enumOptions(PROBLEM_URGENCIES)}
            onChange={(v) => onChange({ urgency: v })}
          />
          <Select
            label="Priority"
            value={state.priority}
            options={enumOptions(PRIORITY_TIERS)}
            onChange={(v) => onChange({ priority: v })}
          />
          <Select
            label="Status"
            value={state.status}
            options={enumOptions(PROBLEM_STATUSES.filter((s) => s !== 'DRAFT'))}
            onChange={(v) => onChange({ status: v })}
          />
          <Select
            label="Verified"
            value={state.verified}
            options={yesNo}
            onChange={(v) => onChange({ verified: v as Patch['verified'] })}
          />
          <Select
            label="Resolved"
            value={state.resolved}
            options={yesNo}
            onChange={(v) => onChange({ resolved: v as Patch['resolved'] })}
          />
        </>
      )}

      {tab !== 'KNOWLEDGE' && (
        <fieldset className="space-y-3">
          <legend className="mb-2 type-body-sm font-medium text-ink">Location</legend>
          <Field label="City">
            <Input
              value={text.city}
              maxLength={100}
              onChange={(e) => setText({ ...text, city: e.target.value })}
            />
          </Field>
          <Field label="State">
            <Input
              value={text.state}
              maxLength={100}
              onChange={(e) => setText({ ...text, state: e.target.value })}
            />
          </Field>
          {tab !== 'ORGANIZATION' && (
            <>
              <Field label="Postal code">
                <Input
                  value={text.postalCode}
                  maxLength={12}
                  onChange={(e) => setText({ ...text, postalCode: e.target.value })}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={nearMe}
                  loading={locating}
                >
                  <LocateFixed aria-hidden="true" />
                  {state.lat ? 'Update my location' : 'Near me'}
                </Button>
                {state.lat && (
                  <>
                    <Select
                      label="Within"
                      any="5 km"
                      value={state.radiusKm === '5' ? undefined : state.radiusKm}
                      options={['1', '2', '10', '25', '50'].map((v) => ({
                        value: v,
                        label: `${v} km`,
                      }))}
                      onChange={(v) => onChange({ radiusKm: v ?? '5' })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onChange({ lat: undefined, lng: undefined, radiusKm: undefined })
                      }
                    >
                      Clear location
                    </Button>
                  </>
                )}
              </div>
              {locationError && (
                <p className="type-caption text-danger">{locationError}</p>
              )}
            </>
          )}
        </fieldset>
      )}

      {(tab === 'ALL' || tab === 'PROBLEM') && (
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-2 type-body-sm font-medium text-ink">Reported</legend>
          <Field label="From">
            <Input
              type="date"
              value={text.from}
              onChange={(e) => setText({ ...text, from: e.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={text.to}
              onChange={(e) => setText({ ...text, to: e.target.value })}
            />
          </Field>
        </fieldset>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Clear all
        </Button>
      </div>
    </form>
  );
}
