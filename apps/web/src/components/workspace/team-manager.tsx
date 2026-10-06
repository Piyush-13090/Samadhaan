'use client';

import { MailPlus, UserMinus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  INVITABLE_MEMBER_ROLES,
  type InvitableMemberRole,
  type OrganizationMemberRole,
  type OrganizationMemberSummary,
  type WorkspacePermissions,
} from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { formatDate } from '@/lib/format';
import {
  MEMBERSHIP_ROLE_LABEL,
  MEMBERSHIP_ROLE_WITH_ARTICLE,
  MEMBERSHIP_STATUS_LABEL,
} from '@/lib/profile-display';
import {
  changeMemberRole,
  inviteMember,
  removeMember,
} from '@/services/workspace.service';

/**
 * The team, and — for owners and admins — its management.
 *
 * The rules shown here mirror the API's so that unusable controls are hidden,
 * but they decide nothing: every change is re-checked server-side, where a
 * member cannot change their own role, an admin cannot touch an owner or make
 * one, and the last owner cannot be removed. A refusal from the server is
 * shown as-is.
 *
 * Only public identity is listed — name, avatar, role, status. The API does
 * not send members' email addresses or phone numbers, so they cannot leak here.
 */
export function TeamManager({
  organizationId,
  members,
  viewerMembershipId,
  viewerRole,
  permissions,
}: {
  organizationId: string;
  members: OrganizationMemberSummary[];
  viewerMembershipId: string;
  viewerRole: OrganizationMemberRole;
  permissions: WorkspacePermissions;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OrganizationMemberSummary | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const active = members.filter((member) => member.status !== 'INVITED');
  const invited = members.filter((member) => member.status === 'INVITED');

  function canChange(member: OrganizationMemberSummary): boolean {
    if (!permissions.canManageMembers) return false;
    if (member.id === viewerMembershipId) return false;
    if (viewerRole !== 'OWNER' && member.membershipRole === 'OWNER') return false;
    return true;
  }

  function fail(title: string, error: unknown) {
    toast({
      tone: 'danger',
      title,
      description:
        error instanceof ApiError
          ? error.message
          : 'Check your connection and try again.',
    });
  }

  async function onRoleChange(
    member: OrganizationMemberSummary,
    role: OrganizationMemberRole,
  ) {
    if (role === member.membershipRole) return;
    setBusyId(member.id);
    try {
      await changeMemberRole(organizationId, member.id, role);
      toast({
        tone: 'success',
        title: `${member.user.fullName} is now ${MEMBERSHIP_ROLE_WITH_ARTICLE[role]}`,
      });
      router.refresh();
    } catch (error) {
      fail("Couldn't change that role", error);
    } finally {
      setBusyId(null);
    }
  }

  async function onRemoveConfirmed() {
    if (!removing) return;
    const member = removing;
    setBusyId(member.id);
    try {
      await removeMember(organizationId, member.id);
      toast({
        tone: 'success',
        title:
          member.status === 'INVITED'
            ? `Invitation to ${member.user.fullName} withdrawn`
            : `${member.user.fullName} removed from the team`,
      });
      setRemoving(null);
      router.refresh();
    } catch (error) {
      fail("Couldn't remove that member", error);
    } finally {
      setBusyId(null);
    }
  }

  const row = (member: OrganizationMemberSummary) => {
    const isSelf = member.id === viewerMembershipId;
    const changeable = canChange(member);

    return (
      <li
        key={member.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control px-2.5 py-3 sm:flex-nowrap"
      >
        <Avatar
          name={member.user.fullName}
          src={member.user.avatarUrl ?? undefined}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate type-body-sm font-medium text-ink">
            {member.user.fullName}
            {isSelf && <span className="font-normal text-ink-subtle"> (you)</span>}
          </p>
          <p className="type-caption text-ink-subtle">
            {member.joinedAt
              ? `Joined ${formatDate(member.joinedAt)}`
              : 'Invitation pending'}
          </p>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          {member.status !== 'ACTIVE' && (
            <Badge tone={member.status === 'INVITED' ? 'warning' : 'danger'} size="sm">
              {MEMBERSHIP_STATUS_LABEL[member.status]}
            </Badge>
          )}

          {changeable && member.status === 'ACTIVE' ? (
            <Select
              value={member.membershipRole}
              disabled={busyId === member.id}
              onValueChange={(value) =>
                void onRoleChange(member, value as OrganizationMemberRole)
              }
            >
              <SelectTrigger
                className="h-9 w-32"
                aria-label={`Role for ${member.user.fullName}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {permissions.assignableRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {MEMBERSHIP_ROLE_LABEL[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge
              tone={member.membershipRole === 'OWNER' ? 'primary' : 'neutral'}
              size="sm"
            >
              <span className="sr-only">Role: </span>
              {MEMBERSHIP_ROLE_LABEL[member.membershipRole]}
            </Badge>
          )}

          {changeable && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              disabled={busyId === member.id}
              aria-label={
                member.status === 'INVITED'
                  ? `Withdraw invitation to ${member.user.fullName}`
                  : `Remove ${member.user.fullName} from the team`
              }
              onClick={() => setRemoving(member)}
              className="ml-auto sm:ml-0"
            >
              <UserMinus />
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Members"
          description={`${active.length} ${active.length === 1 ? 'member' : 'members'}`}
          action={
            permissions.canManageMembers ? (
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<MailPlus />}
                onClick={() => setInviteOpen(true)}
              >
                Invite member
              </Button>
            ) : undefined
          }
        />
        <CardBody className={active.length === 0 ? 'p-0' : 'p-2'}>
          {active.length === 0 ? (
            <EmptyState
              size="sm"
              icon={Users}
              title="No team members yet"
              description={
                permissions.canManageMembers
                  ? 'Invite colleagues who already have a Samadhaan account.'
                  : 'Members appear here once they join the organisation.'
              }
            />
          ) : (
            <ul className="divide-y divide-border-subtle">{active.map(row)}</ul>
          )}
        </CardBody>
      </Card>

      {permissions.canManageMembers && (
        <Card>
          <CardHeader
            title="Pending invitations"
            description="Invitations wait until the person accepts them from their own account."
          />
          <CardBody className={invited.length === 0 ? 'p-0' : 'p-2'}>
            {invited.length === 0 ? (
              <EmptyState size="sm" icon={MailPlus} title="No pending invitations" />
            ) : (
              <ul className="divide-y divide-border-subtle">{invited.map(row)}</ul>
            )}
          </CardBody>
        </Card>
      )}

      {!permissions.canManageMembers && (
        <p className="type-body-sm text-ink-muted">
          Only owners and admins can invite or change members.
        </p>
      )}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        organizationId={organizationId}
        onInvited={(member) => {
          toast({ tone: 'success', title: `Invitation sent to ${member.user.fullName}` });
          setInviteOpen(false);
          router.refresh();
        }}
      />

      <Modal open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <ModalContent
          size="sm"
          title={
            removing?.status === 'INVITED' ? 'Withdraw invitation?' : 'Remove member?'
          }
          description={
            removing
              ? removing.status === 'INVITED'
                ? `${removing.user.fullName} will no longer be able to join.`
                : `${removing.user.fullName} will lose access to this workspace. Their past contributions stay on record.`
              : undefined
          }
          footer={
            <>
              <ModalClose asChild>
                <Button variant="secondary" size="sm">
                  Cancel
                </Button>
              </ModalClose>
              <Button
                variant="danger"
                size="sm"
                loading={busyId !== null}
                onClick={() => void onRemoveConfirmed()}
              >
                {removing?.status === 'INVITED' ? 'Withdraw' : 'Remove'}
              </Button>
            </>
          }
        >
          {null}
        </ModalContent>
      </Modal>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  organizationId,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onInvited: (member: OrganizationMemberSummary) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableMemberRole>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const member = await inviteMember(organizationId, { email, membershipRole: role });
      setEmail('');
      setRole('MEMBER');
      onInvited(member);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Invite a member"
        description="They need a Samadhaan account. The invitation appears in their organisations list to accept or decline."
      >
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
          <Field label="Email address" error={error ?? undefined}>
            <Input
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field
            label="Role"
            hint="Admins can manage the team and settings. Ownership is shared later, by an owner."
          >
            <Select
              value={role}
              onValueChange={(value) => setRole(value as InvitableMemberRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_MEMBER_ROLES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {MEMBERSHIP_ROLE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <ModalClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </ModalClose>
            <Button type="submit" variant="primary" size="sm" loading={pending}>
              Send invitation
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
