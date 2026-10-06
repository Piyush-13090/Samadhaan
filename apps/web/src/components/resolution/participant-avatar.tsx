import type { ResolutionParticipantSide } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

/**
 * A participant's avatar with a side marker. The ring colour distinguishes
 * government from organisation at a glance; the name and organisation beside
 * it always say the same thing in words.
 */
export function ParticipantAvatar({
  name,
  avatarUrl,
  side,
  size = 'sm',
}: {
  name: string;
  avatarUrl: string | null;
  side: ResolutionParticipantSide;
  size?: 'xs' | 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-fit shrink-0 self-start rounded-full ring-2 ring-offset-1 ring-offset-surface',
        side === 'GOVERNMENT' ? 'ring-info-border' : 'ring-success-border',
      )}
    >
      <Avatar name={name} src={avatarUrl ?? undefined} size={size} />
    </span>
  );
}
