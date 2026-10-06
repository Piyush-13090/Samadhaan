import { MapPinOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

/** Shown while the map library and its style load. Holds the map's space. */
export function MapLoadingState({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading map"
      className={cn('absolute inset-0 animate-shimmer bg-subtle', className)}
    >
      <span className="sr-only">Loading map</span>
    </div>
  );
}

/**
 * The map could not be shown — no WebGL, the tile service is down, or maps are
 * switched off. Never a dead end: it says where the same information is, and
 * the page around it keeps its list.
 */
export function MapErrorState({
  message = 'The map could not be loaded.',
  hint = 'Problems are still listed alongside.',
  onRetry,
  className,
}: {
  message?: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-2 bg-subtle p-4 text-center',
        className,
      )}
    >
      <MapPinOff className="size-6 text-ink-subtle" aria-hidden="true" />
      <p className="type-body-sm font-medium text-ink">{message}</p>
      <p className="type-caption text-ink-muted">{hint}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      )}
    </div>
  );
}
