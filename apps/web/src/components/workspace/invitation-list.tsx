'use client';

import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { WorkspaceInvitation } from '@samadhaan/shared';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { formatRelativeTime } from '@/lib/format';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';
import { ORGANIZATION_TYPE_LABEL, workspacePath } from '@/lib/workspace';
import { respondToInvitation } from '@/services/workspace.service';

/**
 * Invitations waiting for the signed-in user.
 *
 * Accepting is the only way into a workspace one was invited to — an
 * invitation is not membership until its recipient says yes. The API checks
 * the invitation is addressed to this account, so nobody can answer another
 * person's.
 */
export function InvitationList({ invitations }: { invitations: WorkspaceInvitation[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function respond(
    invitation: WorkspaceInvitation,
    response: 'accept' | 'decline',
  ) {
    setBusy(invitation.membershipId);
    try {
      await respondToInvitation(invitation.membershipId, response);
      if (response === 'accept') {
        toast({
          tone: 'success',
          title: `You've joined ${invitation.organization.name}`,
        });
        router.push(workspacePath(invitation.organization.slug));
      } else {
        toast({ title: `Invitation from ${invitation.organization.name} declined` });
      }
      // The shell's workspace list comes from the layout, which does not
      // re-render on navigation by itself.
      router.refresh();
    } catch (error) {
      toast({
        tone: 'danger',
        title: "Couldn't answer that invitation",
        description:
          error instanceof ApiError
            ? error.message
            : 'Check your connection and try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Invitations"
        description="Organisations that have invited you to join their team."
      />
      <CardBody className="p-2">
        <ul className="divide-y divide-border-subtle">
          {invitations.map((invitation) => (
            <li
              key={invitation.membershipId}
              className="flex flex-wrap items-center gap-x-3 gap-y-3 px-2.5 py-3"
            >
              <Avatar
                name={invitation.organization.name}
                src={invitation.organization.logoUrl ?? undefined}
                size="md"
                className="rounded-control"
              />
              <div className="min-w-0 flex-1">
                <p className="type-body-sm font-medium text-ink">
                  {invitation.organization.name}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 type-caption text-ink-subtle">
                  {ORGANIZATION_TYPE_LABEL[invitation.organization.type]} · as{' '}
                  {MEMBERSHIP_ROLE_LABEL[invitation.membershipRole].toLowerCase()} ·
                  invited {formatRelativeTime(invitation.invitedAt)}
                  <VerificationBadge
                    status={invitation.organization.verificationStatus}
                    size="sm"
                  />
                </p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<X />}
                  disabled={busy !== null}
                  onClick={() => void respond(invitation, 'decline')}
                  aria-label={`Decline invitation from ${invitation.organization.name}`}
                  className="flex-1 sm:flex-none"
                >
                  Decline
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leadingIcon={<Check />}
                  loading={busy === invitation.membershipId}
                  disabled={busy !== null}
                  onClick={() => void respond(invitation, 'accept')}
                  aria-label={`Accept invitation from ${invitation.organization.name}`}
                  className="flex-1 sm:flex-none"
                >
                  Accept
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
