'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-full border border-border bg-subtle',
  {
    variants: {
      size: {
        xs: 'size-6 type-overline',
        sm: 'size-8 type-label',
        md: 'size-10 type-body-sm',
        lg: 'size-12 type-body',
        xl: 'size-16 type-h4',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  name: string;
  src?: string;
  className?: string;
}

/**
 * Avatar with an initials fallback.
 *
 * Radix only swaps in the fallback once the image genuinely fails or is still
 * loading, which avoids the flash of initials that a naive `onError` produces.
 */
export function Avatar({ name, src, size, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root className={cn(avatarVariants({ size }), className)}>
      {src && (
        <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />
      )}
      <AvatarPrimitive.Fallback
        className="flex size-full items-center justify-center bg-primary-soft font-medium text-primary"
        delayMs={src ? 300 : 0}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export interface AvatarGroupProps {
  people: Array<{ id: string; name: string; avatarUrl?: string }>;
  /** Show at most this many, then a `+N` chip. */
  max?: number;
  size?: AvatarProps['size'];
  className?: string;
}

/**
 * Overlapping avatars with an overflow count.
 *
 * The group is labelled as a list so a screen reader announces every name,
 * rather than reading a row of images with no context.
 */
export function AvatarGroup({
  people,
  max = 4,
  size = 'sm',
  className,
}: AvatarGroupProps) {
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;

  return (
    <div
      className={cn('flex items-center -space-x-2', className)}
      role="list"
      aria-label={`${people.length} contributors`}
    >
      {visible.map((person) => (
        <div key={person.id} role="listitem" title={person.name}>
          <Avatar
            name={person.name}
            src={person.avatarUrl}
            size={size}
            className="ring-2 ring-surface"
          />
        </div>
      ))}

      {overflow > 0 && (
        <div
          role="listitem"
          className={cn(
            avatarVariants({ size }),
            'items-center justify-center bg-subtle font-medium text-ink-muted ring-2 ring-surface',
          )}
        >
          <span className="flex size-full items-center justify-center">+{overflow}</span>
        </div>
      )}
    </div>
  );
}
