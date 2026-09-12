import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import type { ProblemCategory } from '@/types/domain';
import { Badge } from '@/components/ui/badge';

/**
 * Problem category. Always neutral-toned: category is a classification, not a
 * judgement, and giving each one its own colour would compete with severity
 * and status for the reader's attention.
 */
export function CategoryBadge({
  category,
  short = false,
  size = 'md',
  className,
}: {
  category: ProblemCategory;
  /** Use the abbreviated label in dense rows. */
  short?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const display = CATEGORY_DISPLAY[category];

  return (
    <Badge tone="neutral" size={size} className={className}>
      {short ? display.short : display.label}
    </Badge>
  );
}
