'use client';

import { Crosshair, MapPin } from 'lucide-react';
import type { ReportLocationInput } from '@samadhaan/shared';
import { REPORT_LIMITS } from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MapPlaceholder } from '@/components/problems/map-placeholder';
import { cn } from '@/lib/cn';
import { useGeolocation } from '@/hooks/use-geolocation';

/**
 * Picks the place a problem exists.
 *
 * Two routes to a location, and both are first-class: detect it, or type the
 * address and coordinates. Geolocation is offered first because it is the
 * fastest path for someone standing at the problem, but it is never required —
 * permission may be denied, the device may have no fix, and a citizen may be
 * reporting something they saw earlier from somewhere else.
 *
 * The map is `MapPlaceholder` from the design system: an honest stand-in rather
 * than a pretend map. A real tile layer needs a provider and a server-held key,
 * which this milestone does not configure; swapping it in changes this one
 * element and nothing around it.
 */
export function LocationSelector({
  value,
  onChange,
  errors = {},
}: {
  value: Partial<ReportLocationInput>;
  onChange: (location: Partial<ReportLocationInput>) => void;
  errors?: Record<string, string>;
}) {
  const geolocation = useGeolocation();

  const hasCoordinates =
    typeof value.latitude === 'number' && typeof value.longitude === 'number';

  const set = <K extends keyof ReportLocationInput>(
    key: K,
    next: ReportLocationInput[K],
  ) => onChange({ ...value, [key]: next });

  async function detect() {
    const position = await geolocation.request();
    if (!position) return;

    onChange({
      ...value,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracyMeters,
    });
  }

  /** Parses a typed coordinate, leaving it unset rather than storing NaN. */
  function setCoordinate(key: 'latitude' | 'longitude', raw: string) {
    const parsed = Number.parseFloat(raw);
    onChange({
      ...value,
      [key]: raw.trim() === '' || Number.isNaN(parsed) ? undefined : parsed,
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="type-label text-ink">
          Where is the problem?
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </p>
        <p className="mt-1 type-caption text-ink-subtle">
          Pin the exact place. This is how Samadhaan routes your report to the right local
          body.
        </p>
      </div>

      <Button
        type="button"
        variant="secondary"
        leadingIcon={<Crosshair />}
        loading={geolocation.status === 'locating'}
        onClick={() => void detect()}
        fullWidth
        className="sm:w-auto"
      >
        {geolocation.status === 'locating' ? 'Finding you…' : 'Use my current location'}
      </Button>

      {geolocation.error && (
        <Alert tone="warning" title="Could not use your location">
          {geolocation.error}
        </Alert>
      )}

      {hasCoordinates && (
        <div className="overflow-hidden rounded-card border border-border">
          <MapPlaceholder
            className="h-44"
            label={value.address ?? value.city ?? 'Selected location'}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2.5">
            <span className="inline-flex items-center gap-1.5 type-caption text-ink-muted">
              <MapPin className="size-3.5" aria-hidden="true" />
              <span className="font-mono tabular">
                {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
              </span>
            </span>
            {typeof value.accuracyMeters === 'number' && (
              <span className="type-caption text-ink-subtle">
                Accurate to about {value.accuracyMeters} m
              </span>
            )}
          </div>
        </div>
      )}

      <div className={cn('grid gap-4 sm:grid-cols-2')}>
        <Field
          label="Latitude"
          required
          error={errors.latitude}
          hint={hasCoordinates ? undefined : 'Detected, or entered manually'}
        >
          <Input
            type="number"
            step="0.000001"
            inputMode="decimal"
            value={value.latitude ?? ''}
            onChange={(event) => setCoordinate('latitude', event.target.value)}
            placeholder="28.459500"
          />
        </Field>

        <Field label="Longitude" required error={errors.longitude}>
          <Input
            type="number"
            step="0.000001"
            inputMode="decimal"
            value={value.longitude ?? ''}
            onChange={(event) => setCoordinate('longitude', event.target.value)}
            placeholder="77.026600"
          />
        </Field>
      </div>

      <Field
        label="Address or landmark"
        hint="Helps people recognise the place. Optional but useful."
        error={errors.address}
      >
        <Input
          value={value.address ?? ''}
          onChange={(event) => set('address', event.target.value)}
          placeholder="Sector 12 Market Road, near the bus stop"
          maxLength={REPORT_LIMITS.addressMax}
          autoComplete="street-address"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" error={errors.city}>
          <Input
            value={value.city ?? ''}
            onChange={(event) => set('city', event.target.value)}
            maxLength={REPORT_LIMITS.localityMax}
            autoComplete="address-level2"
          />
        </Field>

        <Field label="State" error={errors.state}>
          <Input
            value={value.state ?? ''}
            onChange={(event) => set('state', event.target.value)}
            maxLength={REPORT_LIMITS.localityMax}
            autoComplete="address-level1"
          />
        </Field>

        <Field label="Postal code" error={errors.postalCode}>
          <Input
            value={value.postalCode ?? ''}
            onChange={(event) => set('postalCode', event.target.value)}
            maxLength={REPORT_LIMITS.postalCodeMax}
            autoComplete="postal-code"
          />
        </Field>
      </div>
    </div>
  );
}
