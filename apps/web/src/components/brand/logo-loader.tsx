import { cn } from '@/lib/cn';
import { LogoMark } from './logo';

/**
 * Branded loading state, for the initial app boot where a bare spinner would
 * leave the screen unidentifiable. The mark pulses rather than spins — a
 * rotating logo reads as broken.
 */
export function LogoLoader({
  label = 'Loading Samadhaan',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      className={cn('flex flex-col items-center justify-center gap-4', className)}
    >
      <span className="grid size-12 animate-shimmer place-items-center rounded-xl bg-primary text-ink-inverse">
        <LogoMark className="size-7" />
      </span>
      <p className="type-body-sm text-ink-muted">{label}</p>
    </div>
  );
}
