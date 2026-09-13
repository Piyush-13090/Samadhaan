import { Sparkles } from 'lucide-react';
import type { OrganizationExpertiseEntry } from '@samadhaan/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { EXPERTISE_DISPLAY } from '@/lib/profile-display';

/**
 * What an organisation works on.
 *
 * Level is shown as filled pips as well as a word, so it survives greyscale and
 * colour blindness. Categories come from the same taxonomy problems use, which
 * is what will later let the matcher compare the two directly.
 */
export function ExpertiseList({
  expertise,
  action,
}: {
  expertise: OrganizationExpertiseEntry[];
  /** Management control, rendered only for authorised viewers. */
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title="Areas of work"
        description="What this organisation takes on."
        action={action}
      />

      <CardBody className={expertise.length === 0 ? 'p-0' : undefined}>
        {expertise.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Sparkles}
            title="No areas listed yet"
            description="Areas of work help Samadhaan connect this organisation with relevant problems."
          />
        ) : (
          <ul className="space-y-2.5">
            {expertise.map((entry) => {
              const level = EXPERTISE_DISPLAY[entry.level];

              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-control border border-border-subtle px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="type-body-sm font-medium text-ink">
                      {CATEGORY_DISPLAY[entry.category].label}
                    </p>
                    {entry.subcategory && (
                      <p className="mt-0.5 truncate type-caption text-ink-subtle">
                        {entry.subcategory}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span aria-hidden="true" className="flex items-center gap-0.5">
                      {[1, 2, 3].map((pip) => (
                        <span
                          key={pip}
                          className={cn(
                            'size-1.5 rounded-full',
                            pip <= level.pips ? 'bg-primary' : 'bg-border-strong',
                          )}
                        />
                      ))}
                    </span>
                    <span className="type-caption text-ink-muted">{level.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
