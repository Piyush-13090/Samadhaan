import { Users } from 'lucide-react';
import type { OrganizationMemberSummary } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';

/**
 * The organisation's people.
 *
 * Public identity only — no email, no phone. The API enforces that; this
 * component could not render them because `OrganizationMemberSummary` does not
 * carry them.
 */
export function TeamList({ members }: { members: OrganizationMemberSummary[] }) {
  return (
    <Card>
      <CardHeader
        title="Team"
        description={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
      />

      <CardBody className={members.length === 0 ? 'p-0' : 'p-2'}>
        {members.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Users}
            title="No members yet"
            description="Members appear here once they join the organisation."
          />
        ) : (
          <ul className="space-y-1">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-control px-2.5 py-2.5"
              >
                <Avatar
                  name={member.user.fullName}
                  src={member.user.avatarUrl ?? undefined}
                  size="sm"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate type-body-sm font-medium text-ink">
                    {member.user.fullName}
                  </p>
                  <p className="type-caption text-ink-subtle">
                    {member.joinedAt
                      ? `Joined ${formatDate(member.joinedAt)}`
                      : 'Invitation pending'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {member.status === 'INVITED' && (
                    <Badge tone="warning" size="sm">
                      Invited
                    </Badge>
                  )}
                  <Badge
                    tone={member.membershipRole === 'OWNER' ? 'primary' : 'neutral'}
                    size="sm"
                  >
                    {MEMBERSHIP_ROLE_LABEL[member.membershipRole]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
