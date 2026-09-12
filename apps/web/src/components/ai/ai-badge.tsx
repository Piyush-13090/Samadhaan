import { cn } from '@/lib/cn';

/**
 * The AI mark: a four-point star ("✦") drawn as a path.
 *
 * Chosen over a brain, robot or sparkle cluster because it is quiet enough to
 * sit inline in a card header without turning the interface into a toy, and
 * distinct enough that teal + this shape reliably reads as "Samadhaan AI".
 */
export function AiSparkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn('size-3.5', className)}
      aria-hidden="true"
    >
      <path
        d="M8 1.25c.28 2.63 1.37 4.36 3.6 4.75-2.23.39-3.32 2.12-3.6 4.75-.28-2.63-1.37-4.36-3.6-4.75 2.23-.39 3.32-2.12 3.6-4.75Z"
        fill="currentColor"
      />
      <path
        d="M12.6 9.4c.16 1.32.75 2.18 1.9 2.35-1.15.17-1.74 1.03-1.9 2.35-.16-1.32-.75-2.18-1.9-2.35 1.15-.17 1.74-1.03 1.9-2.35Z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}

/**
 * Label marking content as machine-generated.
 *
 * Every AI-produced value in Samadhaan carries this. It is a disclosure, not
 * decoration: a citizen reading a severity score must be able to tell at a
 * glance that a model produced it and a person has not yet confirmed it.
 */
export function AiBadge({
  label = 'AI insight',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[6px] border border-ai-border',
        'bg-ai-soft px-2 py-0.5 type-overline text-ai',
        className,
      )}
    >
      <AiSparkIcon className="size-3" />
      {label}
    </span>
  );
}
