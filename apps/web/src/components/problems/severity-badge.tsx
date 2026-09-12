import { cn } from '@/lib/cn';
import { SEVERITY_DISPLAY } from '@/lib/domain-display';
import type { SeverityLevel } from '@/types/domain';
import { Badge } from '@/components/ui/badge';

/**
 * Severity as a labelled four-bar meter.
 *
 * The bars are the point: severity is the value most likely to be scanned
 * quickly and most costly to misread, so it must not rest on colour alone.
 * Low/Medium/High/Critical is legible to a colour-blind user, in greyscale
 * print, and to a screen reader via the label.
 */
export function SeverityBadge({
  severity,
  size = 'md',
  showBars = true,
  className,
}: {
  severity: SeverityLevel;
  size?: 'sm' | 'md';
  showBars?: boolean;
  className?: string;
}) {
  const display = SEVERITY_DISPLAY[severity];

  return (
    <Badge tone={display.tone} size={size} className={className}>
      {showBars && (
        <span aria-hidden="true" className="flex items-end gap-px">
          {[1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className={cn(
                'w-0.5 rounded-[1px] transition-colors',
                bar === 1 && 'h-1.5',
                bar === 2 && 'h-2',
                bar === 3 && 'h-2.5',
                bar === 4 && 'h-3',
                bar <= display.bars ? 'bg-current' : 'bg-current/25',
              )}
            />
          ))}
        </span>
      )}
      <span>{display.label}</span>
      <span className="sr-only"> severity</span>
    </Badge>
  );
}
