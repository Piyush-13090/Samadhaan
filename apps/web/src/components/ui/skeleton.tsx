import { cn } from '@/lib/cn';

/**
 * Loading placeholders.
 *
 * Skeletons mirror the shape of the content they replace, so nothing jumps when
 * data arrives — the reason to prefer them over a spinner for known layouts.
 *
 * The whole group is hidden from assistive technology; the surrounding region
 * carries `aria-busy` instead, so a screen reader hears "loading" once rather
 * than a stream of empty boxes.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-shimmer rounded-control bg-subtle', className)}
    />
  );
}

/** Lines of text. The last line is shortened, as real paragraphs are. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

export function SkeletonAvatar({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes = { sm: 'size-8', md: 'size-10', lg: 'size-12' };
  return <Skeleton className={cn('rounded-full', sizes[size], className)} />;
}

/** Placeholder shaped like a `ProblemCard`. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-card border border-border bg-surface p-4', className)}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="mt-3 h-4.5 w-3/4" />
      <SkeletonText lines={2} className="mt-2.5" />
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SkeletonAvatar size="sm" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/** Placeholder for the dashboard: greeting, stat row, then a card list. */
export function SkeletonDashboard() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-72" />

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-card border border-border bg-surface p-4"
            aria-hidden="true"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>

      <Skeleton className="mt-10 h-5 w-40" />
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}
