import type { ResolutionParticipants } from '@samadhaan/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';
import { ParticipantAvatar } from './participant-avatar';

/**
 * Everyone who can read this room: the current active members of the office
 * and of the organisation. Name, role and organisation only.
 */
export function ParticipantsPanel({
  participants,
}: {
  participants: ResolutionParticipants | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Participants"
        description="Active members of both organisations."
      />
      <CardBody className="space-y-5">
        {participants === null ? (
          <p className="type-body-sm text-ink-muted">Loading participants…</p>
        ) : (
          [participants.government, participants.organization].map((group, index) => (
            <section key={group.name} aria-label={group.name}>
              <h3 className="type-overline text-ink-subtle">
                {index === 0 ? 'Government' : 'Organisation'} · {group.name}
              </h3>
              <ul className="mt-2 space-y-2.5">
                {group.members.map((member) => (
                  <li key={member.userId} className="flex items-center gap-2.5">
                    <ParticipantAvatar
                      name={member.name}
                      avatarUrl={member.avatarUrl}
                      side={member.side}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate type-body-sm text-ink">
                        {member.name}
                      </span>
                      <span className="block type-caption text-ink-subtle">
                        {MEMBERSHIP_ROLE_LABEL[member.membershipRole]}
                        {!member.joined && ' · Not joined yet'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </CardBody>
    </Card>
  );
}
