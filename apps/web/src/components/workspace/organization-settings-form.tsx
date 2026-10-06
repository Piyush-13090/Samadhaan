'use client';

import { MapPin, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ORGANIZATION_LIMITS, type OrganizationWorkspace } from '@samadhaan/shared';
import { LocationPicker } from '@/components/map/location-picker';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import type { LatLng } from '@/lib/map/types';
import { updateOrganization } from '@/services/profile.service';

const TEXT_FIELDS = [
  'name',
  'description',
  'websiteUrl',
  'logoUrl',
  'email',
  'phone',
  'address',
  'city',
  'state',
  'postalCode',
] as const;

type TextField = (typeof TEXT_FIELDS)[number];
type Values = Record<TextField, string>;

function initialValues(workspace: OrganizationWorkspace): Values {
  const org = workspace.organization;
  return {
    name: org.name,
    description: org.description ?? '',
    websiteUrl: org.websiteUrl ?? '',
    logoUrl: org.logoUrl ?? '',
    email: org.email ?? '',
    phone: org.phone ?? '',
    address: org.address ?? '',
    city: org.location.city ?? '',
    state: org.location.state ?? '',
    // The public profile does not carry the postal code; it is edited, not shown.
    postalCode: '',
  };
}

/**
 * Organisation information, contact details and registered location.
 *
 * Only the fields the API lets an organisation change are here. Type,
 * verification, slug and membership roles are not editable through this form
 * — the API rejects them outright — and the page says so beside them.
 *
 * Only changed fields are sent, and an emptied field is sent as `null` so the
 * API clears it rather than ignoring it.
 */
export function OrganizationSettingsForm({
  workspace,
}: {
  workspace: OrganizationWorkspace;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const organizationId = workspace.organization.id;

  const [initial, setInitial] = useState(() => initialValues(workspace));
  const [values, setValues] = useState(initial);
  const [position, setPosition] = useState<LatLng | null>(workspace.coordinates);
  const [errors, setErrors] = useState<Partial<Record<TextField | 'location', string>>>(
    {},
  );
  const [saving, setSaving] = useState(false);

  const coordinatesChanged =
    position?.latitude !== workspace.coordinates?.latitude ||
    position?.longitude !== workspace.coordinates?.longitude;

  const changed = TEXT_FIELDS.filter((key) => values[key].trim() !== initial[key].trim());
  const dirty = changed.length > 0 || coordinatesChanged;

  function set(key: TextField, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (values.name.trim().length < ORGANIZATION_LIMITS.nameMin) {
      setErrors({ name: 'Enter the organisation’s name.' });
      return;
    }

    const body: Record<string, unknown> = {};
    for (const key of changed) {
      const trimmed = values[key].trim();
      body[key] = trimmed === '' ? null : trimmed;
    }
    if (coordinatesChanged) {
      body.latitude = position ? Number(position.latitude.toFixed(6)) : null;
      body.longitude = position ? Number(position.longitude.toFixed(6)) : null;
    }

    setSaving(true);
    setErrors({});
    try {
      await updateOrganization(organizationId, body);
      setInitial(values);
      toast({ tone: 'success', title: 'Organisation details saved' });
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        const fieldErrors: Partial<Record<TextField | 'location', string>> = {};
        for (const detail of error.details) {
          const field = detail.field?.split('.')[0];
          if (field === 'latitude' || field === 'longitude')
            fieldErrors.location = detail.message;
          else if (field && (TEXT_FIELDS as readonly string[]).includes(field)) {
            fieldErrors[field as TextField] = detail.message;
          }
        }
        setErrors(fieldErrors);
      }
      toast({
        tone: 'danger',
        title: "Couldn't save the changes",
        description:
          error instanceof ApiError
            ? error.message
            : 'Check your connection and try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  const text = (
    key: TextField,
    label: string,
    options: {
      hint?: string;
      type?: string;
      maxLength?: number;
      autoComplete?: string;
    } = {},
  ) => (
    <Field label={label} hint={options.hint} error={errors[key]}>
      <Input
        type={options.type ?? 'text'}
        value={values[key]}
        maxLength={options.maxLength}
        autoComplete={options.autoComplete ?? 'off'}
        onChange={(event) => set(key, event.target.value)}
      />
    </Field>
  );

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-5">
      <Card>
        <CardHeader
          title="Organisation information"
          description="How your organisation appears on its public profile."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {text('name', 'Name', { maxLength: ORGANIZATION_LIMITS.nameMax })}
          </div>
          <div className="sm:col-span-2">
            <Field
              label="Description"
              hint="What your organisation does, in a few sentences."
              error={errors.description}
            >
              <Textarea
                rows={4}
                value={values.description}
                maxLength={ORGANIZATION_LIMITS.descriptionMax}
                onChange={(event) => set('description', event.target.value)}
              />
            </Field>
          </div>
          {text('websiteUrl', 'Website', { type: 'url', hint: 'Starting with https://' })}
          {text('logoUrl', 'Logo URL', {
            type: 'url',
            hint: 'A square image, http(s) only.',
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contact details"
          description="Shown publicly once Samadhaan has verified your organisation. Members always see them."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {text('email', 'Contact email', { type: 'email' })}
          {text('phone', 'Phone', { type: 'tel' })}
          <div className="sm:col-span-2">
            {text('address', 'Street address', {
              maxLength: ORGANIZATION_LIMITS.addressMax,
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Location and service area"
          description="Problems within 25 km of this point count as in your service area. The exact point is never shown publicly — only your city and state."
          icon={<MapPin className="size-4" />}
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {text('city', 'City', { maxLength: ORGANIZATION_LIMITS.localityMax })}
            {text('state', 'State', { maxLength: ORGANIZATION_LIMITS.localityMax })}
            {text('postalCode', 'Postal code', {
              maxLength: 16,
              hint: 'Leave blank to keep the current one.',
            })}
          </div>

          <LocationPicker
            value={position}
            onChange={setPosition}
            onUseAddress={(place) => {
              setValues((current) => ({
                ...current,
                address: place.address ?? current.address,
                city: place.city ?? current.city,
                state: place.state ?? current.state,
                postalCode: place.postalCode ?? current.postalCode,
              }));
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 type-caption text-ink-muted">
            <span className="tabular">
              {position
                ? `Registered point: ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`
                : 'No registered point. Your service area falls back to your city.'}
            </span>
            {position && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setPosition(null)}
              >
                Clear point
              </Button>
            )}
          </div>
          {errors.location && (
            <p role="alert" className="type-caption text-danger">
              {errors.location}
            </p>
          )}
        </CardBody>
        <CardFooter className="justify-end">
          {dirty && (
            <span className="mr-auto type-caption text-ink-muted">Unsaved changes</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => {
              setValues(initial);
              setPosition(workspace.coordinates);
              setErrors({});
            }}
          >
            Discard
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            leadingIcon={<Save />}
            loading={saving}
            disabled={!dirty}
          >
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
