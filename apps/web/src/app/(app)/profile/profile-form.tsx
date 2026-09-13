'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PROFILE_LIMITS, type OwnProfile } from '@samadhaan/shared';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { ROLE_LABEL } from '@/lib/role-display';
import { updateOwnProfile } from '@/services/profile.service';

/**
 * Edits the fields a user may change about themselves.
 *
 * Email and role are shown read-only. That is presentation matching a real
 * constraint, not the constraint itself: `UpdateProfileDto` has no such fields,
 * so a crafted request carrying them is rejected by the API regardless of what
 * this form renders.
 */
export function ProfileForm({ profile }: { profile: OwnProfile }) {
  const { refresh } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [form, setForm] = useState({
    fullName: profile.fullName,
    displayName: profile.displayName ?? '',
    bio: profile.bio ?? '',
    city: profile.location.city ?? '',
    state: profile.location.state ?? '',
    country: profile.location.country ?? '',
    postalCode: profile.postalCode ?? '',
    phone: profile.phone ?? '',
    avatarUrl: profile.avatarUrl ?? '',
  });

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const dirty =
    form.fullName !== profile.fullName ||
    form.displayName !== (profile.displayName ?? '') ||
    form.bio !== (profile.bio ?? '') ||
    form.city !== (profile.location.city ?? '') ||
    form.state !== (profile.location.state ?? '') ||
    form.country !== (profile.location.country ?? '') ||
    form.postalCode !== (profile.postalCode ?? '') ||
    form.phone !== (profile.phone ?? '') ||
    form.avatarUrl !== (profile.avatarUrl ?? '');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    // An emptied optional field is sent as null, which clears it server-side;
    // sending "" would store an empty string and read back as set-but-blank.
    const orNull = (value: string) => (value.trim() === '' ? null : value);

    try {
      await updateOwnProfile({
        fullName: form.fullName,
        ...(form.displayName ? { displayName: form.displayName } : {}),
        bio: orNull(form.bio),
        city: orNull(form.city),
        state: orNull(form.state),
        country: orNull(form.country),
        postalCode: orNull(form.postalCode),
        phone: orNull(form.phone),
        avatarUrl: orNull(form.avatarUrl),
      });

      toast({ tone: 'success', title: 'Profile updated' });

      // Refresh the session user (header avatar/name) and re-run the server
      // component so the header above this form shows the new values.
      await refresh();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const mapped: Record<string, string> = {};
        for (const detail of error.details ?? []) {
          if (detail.field) mapped[detail.field] = detail.message;
        }

        setFieldErrors(mapped);

        if (Object.keys(mapped).length === 0) {
          toast({ tone: 'danger', title: 'Could not save', description: error.message });
        }
      } else {
        toast({ tone: 'danger', title: 'Could not save your profile' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader title="Edit profile" description="Only you can change these." />

        <CardBody className="space-y-5">
          <Field label="Full name" required error={fieldErrors.fullName}>
            <Input
              value={form.fullName}
              onChange={(event) => set('fullName')(event.target.value)}
              autoComplete="name"
              maxLength={PROFILE_LIMITS.fullNameMax}
            />
          </Field>

          <Field
            label="Display name"
            hint="Your public handle. Lowercase letters, numbers and underscores."
            error={fieldErrors.displayName}
          >
            <Input
              value={form.displayName}
              onChange={(event) => set('displayName')(event.target.value)}
              placeholder="priya"
              autoComplete="nickname"
              maxLength={PROFILE_LIMITS.displayNameMax}
            />
          </Field>

          <Field
            label="About"
            hint="A sentence or two about your interest in your area."
            error={fieldErrors.bio}
          >
            <Textarea
              value={form.bio}
              onChange={(event) => set('bio')(event.target.value)}
              maxLength={PROFILE_LIMITS.bioMax}
              showCount
              rows={3}
            />
          </Field>

          <Field
            label="Avatar URL"
            hint="A link to an image. Uploads arrive in a later release."
            error={fieldErrors.avatarUrl}
          >
            <Input
              type="url"
              value={form.avatarUrl}
              onChange={(event) => set('avatarUrl')(event.target.value)}
              placeholder="https://example.com/photo.jpg"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="City" error={fieldErrors.city}>
              <Input
                value={form.city}
                onChange={(event) => set('city')(event.target.value)}
                autoComplete="address-level2"
                maxLength={PROFILE_LIMITS.localityMax}
              />
            </Field>

            <Field label="State" error={fieldErrors.state}>
              <Input
                value={form.state}
                onChange={(event) => set('state')(event.target.value)}
                autoComplete="address-level1"
                maxLength={PROFILE_LIMITS.localityMax}
              />
            </Field>

            <Field label="Country" error={fieldErrors.country}>
              <Input
                value={form.country}
                onChange={(event) => set('country')(event.target.value)}
                autoComplete="country-name"
                maxLength={PROFILE_LIMITS.localityMax}
              />
            </Field>

            <Field label="Postal code" error={fieldErrors.postalCode}>
              <Input
                value={form.postalCode}
                onChange={(event) => set('postalCode')(event.target.value)}
                autoComplete="postal-code"
                maxLength={PROFILE_LIMITS.postalCodeMax}
              />
            </Field>
          </div>

          <Field
            label="Phone"
            hint="Kept private. Never shown on your public profile."
            error={fieldErrors.phone}
          >
            <Input
              type="tel"
              value={form.phone}
              onChange={(event) => set('phone')(event.target.value)}
              autoComplete="tel"
            />
          </Field>

          <Field
            label="Email"
            hint="Contact support to change the email on your account."
          >
            <Input value={profile.email} readOnly disabled />
          </Field>

          <Field
            label="Role"
            hint="Roles are assigned by Samadhaan and cannot be changed here."
          >
            <Input value={ROLE_LABEL[profile.role]} readOnly disabled />
          </Field>
        </CardBody>

        <CardFooter className="justify-end">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
