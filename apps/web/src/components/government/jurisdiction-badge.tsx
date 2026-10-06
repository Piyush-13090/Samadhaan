import { MapPinned } from 'lucide-react';
import type { Jurisdiction } from '@samadhaan/shared';
import { Badge } from '@/components/ui/badge';
import { JURISDICTION_TYPE_LABEL } from '@/lib/government';

/**
 * The area a government office is responsible for — and therefore the only
 * problems it can see. Named in text, with how membership of the area is
 * decided, so an official can tell why a problem is or is not theirs.
 */
export function JurisdictionBadge({ jurisdiction }: { jurisdiction: Jurisdiction }) {
  const basis =
    jurisdiction.basis === 'boundary'
      ? 'mapped boundary'
      : jurisdiction.basis === 'cities'
        ? jurisdiction.cities.join(', ')
        : jurisdiction.basis === 'postal-codes'
          ? `${jurisdiction.postalCodes.length} postal codes`
          : 'no area defined';

  return (
    <Badge
      tone={jurisdiction.basis === 'none' ? 'warning' : 'info'}
      size="sm"
      icon={<MapPinned />}
    >
      <span className="sr-only">Jurisdiction: </span>
      {jurisdiction.name ?? 'Jurisdiction'}
      <span className="font-normal opacity-80"> · {basis}</span>
    </Badge>
  );
}

export function jurisdictionTypeLabel(jurisdiction: Jurisdiction): string | null {
  return jurisdiction.type ? JURISDICTION_TYPE_LABEL[jurisdiction.type] : null;
}
