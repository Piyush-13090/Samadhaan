import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/types/ui';

/**
 * Badge — a compact, non-interactive status label.
 *
 * Every tone pairs a tint with a border and a readable foreground, so the badge
 * stays legible against any surface and never depends on colour alone: callers
 * pass an icon or dot for the meaning, and the text always names the state.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap border font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-neutral-border bg-neutral-soft text-ink-muted',
        primary: 'border-primary-border bg-primary-soft text-primary',
        ai: 'border-ai-border bg-ai-soft text-ai',
        info: 'border-info-border bg-info-soft text-info',
        success: 'border-success-border bg-success-soft text-success',
        warning: 'border-warning-border bg-warning-soft text-warning',
        danger: 'border-danger-border bg-danger-soft text-danger',
      } satisfies Record<Tone, string>,
      size: {
        sm: 'rounded-[5px] px-1.5 py-0.5 type-overline tracking-normal normal-case',
        md: 'rounded-[6px] px-2 py-0.5 type-label',
      },
      /** Fully rounded. Use only where the badge is semantically a pill — counts. */
      pill: { true: 'rounded-full', false: '' },
    },
    defaultVariants: { tone: 'neutral', size: 'md', pill: false },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
  /** Leading icon. Decorative — the label must still carry the meaning. */
  icon?: ReactNode;
}

export function Badge({ tone, size, pill, icon, className, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, pill }), className)}>
      {icon}
      {children}
    </span>
  );
}

const DOT_COLORS: Record<Tone, string> = {
  neutral: 'bg-ink-subtle',
  primary: 'bg-primary',
  ai: 'bg-ai',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/** Small filled dot prefixing a status label. Always decorative. */
export function StatusDot({ tone = 'neutral' }: { tone?: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 shrink-0 rounded-full', DOT_COLORS[tone])}
    />
  );
}

/** Numeric count, e.g. unread notifications. Caps at `max` and shows `99+`. */
export function CountBadge({
  count,
  max = 99,
  className,
}: {
  count: number;
  max?: number;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        'inline-flex min-w-4.5 items-center justify-center rounded-full bg-danger px-1',
        'type-overline tabular tracking-normal text-ink-inverse',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

export { badgeVariants };
