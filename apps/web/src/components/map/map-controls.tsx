'use client';

import { Crosshair, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { MapController } from '@/lib/map/types';

/**
 * Zoom and location controls.
 *
 * Our own buttons rather than the library's: 40px targets that suit a thumb,
 * real accessible names, and the design system's focus ring.
 */
export function MapControls({
  controller,
  onLocate,
  locating = false,
  className,
}: {
  controller: MapController | null;
  onLocate?: () => void;
  locating?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-col overflow-hidden rounded-control border border-border bg-surface shadow-card">
        <Button
          variant="ghost"
          size="md"
          iconOnly
          aria-label="Zoom in"
          disabled={!controller}
          onClick={() => controller?.zoomIn()}
          className="rounded-none"
        >
          <Plus />
        </Button>
        <span aria-hidden="true" className="h-px bg-border" />
        <Button
          variant="ghost"
          size="md"
          iconOnly
          aria-label="Zoom out"
          disabled={!controller}
          onClick={() => controller?.zoomOut()}
          className="rounded-none"
        >
          <Minus />
        </Button>
      </div>

      {onLocate && (
        <Button
          variant="secondary"
          size="md"
          iconOnly
          aria-label="Use my location"
          loading={locating}
          onClick={onLocate}
        >
          <Crosshair />
        </Button>
      )}
    </div>
  );
}
