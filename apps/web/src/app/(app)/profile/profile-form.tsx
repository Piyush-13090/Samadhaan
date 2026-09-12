'use client';

import { useState, type FormEvent } from 'react';
import type { AuthenticatedUser } from '@samadhaan/shared';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { ROLE_LABEL } from '@/lib/role-display';
import { updateProfile } from '@/services/auth.service';

/**
 * Edits the fields a user may change about themselves.
 *
 * Email and role are shown read-only. That is presentation matching a real
 * constraint, not the constraint itself: `UpdateProfileDto` has no such fields,
 * so a crafted request that includes them is rejected by the API regardless of
 * what this form renders.
 */
export function ProfileForm({ user }: { user: AuthenticatedUser }) {
  const { setUser } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState(user.fullName);
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty = fullName !== user.fullName || displayName !== (user.displayName ?? '');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    try {
      const updated = await updateProfile({
        fullName,
        ...(displayName ? { displayName } : {}),
      });

      setUser(updated);
      toast({ tone: 'success', title: 'Profile updated' });
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
        <CardHeader title="Account details" />
        <CardBody className="space-y-5">
          <Field label="Full name" required error={fieldErrors.fullName}>
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
            />
          </Field>

          <Field
            label="Display name"
            hint="Used for mentions and on the leaderboard. Lowercase letters, numbers and underscores."
            error={fieldErrors.displayName}
          >
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="priya"
              autoComplete="nickname"
            />
          </Field>

          <Field
            label="Email"
            hint="Contact support to change the email on your account."
          >
            <Input value={user.email} readOnly disabled />
          </Field>

          <Field
            label="Role"
            hint="Roles are assigned by Samadhaan and cannot be changed here."
          >
            <Input value={ROLE_LABEL[user.role]} readOnly disabled />
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
