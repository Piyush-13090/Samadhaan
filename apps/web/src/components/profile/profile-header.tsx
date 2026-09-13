import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import type { OwnProfile, PublicProfile } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { formatLocation } from '@/lib/profile-display';
import { ROLE_LABEL } from '@/lib/role-display';

/**
 * The profile header.
 *
 * Takes `PublicProfile`, which `OwnProfile` extends — so the same component
 * renders both the owner's view and a visitor's, and it is structurally
 * incapable of displaying a private field because the type does not carry one.
 *
 * Stacks on mobile, sits side by side from `sm` upward.
 */
export function ProfileHeader({
  profile,
  action,
}: {
  profile: PublicProfile | OwnProfile;
  /** Right-aligned control, e.g. an edit button for the owner. */
  action?: ReactNode;
}) {
  const location = formatLocation(profile.location);

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <Avatar
          name={profile.fullName}
          src={profile.avatarUrl ?? undefined}
          size="xl"
          className="shrink-0"
        />

        <div className="min-w-0 flex-1">
          <h1 className="type-h2 text-ink">{profile.fullName}</h1>

          {profile.displayName && (
            <p className="mt-0.5 font-mono type-caption text-ink-subtle">
              @{profile.displayName}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="primary">{ROLE_LABEL[profile.role]}</Badge>

            {location && (
              <span className="inline-flex items-center gap-1 type-caption text-ink-muted">
                <MapPin className="size-3.5" aria-hidden="true" />
                {location}
              </span>
            )}

            <span className="type-caption text-ink-subtle">
              Member since {formatDate(profile.createdAt)}
            </span>
          </div>

          {profile.bio && (
            // Rendered as a text node, never with dangerouslySetInnerHTML —
            // a bio is user input and must not be able to inject markup.
            <p className="mt-4 max-w-prose type-body text-ink-muted whitespace-pre-line">
              {profile.bio}
            </p>
          )}
        </div>

        {action && <div className="shrink-0 sm:ml-4">{action}</div>}
      </CardBody>
    </Card>
  );
}
