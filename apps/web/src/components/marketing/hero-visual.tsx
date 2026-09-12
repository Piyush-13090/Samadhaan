import { MapPin, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { MapPlaceholder } from '@/components/problems/map-placeholder';
import { AvatarGroup } from '@/components/ui/avatar';
import { Badge, StatusDot } from '@/components/ui/badge';
import { SeverityBadge } from '@/components/problems/severity-badge';

/**
 * The landing page hero visual.
 *
 * Built entirely from interface elements — no photography, no illustration.
 * That is the right choice here beyond avoiding stock assets: the product's
 * claim is that it turns a street problem into structured, tracked work, and
 * the most honest way to show that is to show the structured, tracked work.
 *
 * Composition: one "problem intelligence" card carrying the whole workflow —
 * reference, AI analysis, community signal, progress — with a map preview and
 * two smaller cards orbiting it to suggest the surrounding system.
 *
 * Entirely decorative, so the whole group is `aria-hidden`. Everything it says
 * is stated in the hero copy beside it; a screen-reader user gets the message
 * without wading through a fake card.
 */
export function HeroVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('relative select-none', className)}>
      {/* Soft tinted ground so the white cards separate from the canvas
          without needing heavy shadows. */}
      <div
        className="absolute -inset-6 -z-10 rounded-container bg-primary-soft/45 sm:-inset-10"
        style={{
          maskImage: 'radial-gradient(75% 75% at 50% 45%, #000 55%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(75% 75% at 50% 45%, #000 55%, transparent 100%)',
        }}
      />

      {/* ---- Primary card: problem intelligence ---------------------------- */}
      <div className="relative rounded-panel border border-border bg-surface shadow-overlay">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono type-caption text-ink-subtle">SAM-1023</span>
            <Badge tone="primary" size="sm" icon={<StatusDot tone="primary" />}>
              In progress
            </Badge>
          </div>
          <SeverityBadge severity="HIGH" size="sm" />
        </div>

        <div className="px-4 pt-3.5 pb-4">
          <h3 className="type-h4 text-ink">Waterlogging near Sector 12</h3>
          <p className="mt-1 inline-flex items-center gap-1 type-caption text-ink-subtle">
            <MapPin className="size-3.5" />
            Sector 12 Market Road · 850 m away
          </p>

          {/* AI analysis block */}
          <div className="mt-4 rounded-card border border-ai-border bg-ai-soft/55 p-3.5">
            <span className="inline-flex items-center gap-1.5 type-overline text-ai">
              <AiSparkIcon className="size-3" />
              AI analysis
            </span>

            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="type-caption text-ink-muted">Category</dt>
                <dd className="mt-0.5 type-body-sm font-semibold text-ink">
                  Water infrastructure
                </dd>
              </div>
              <div>
                <dt className="type-caption text-ink-muted">Severity</dt>
                <dd className="mt-0.5 tabular type-body-sm font-semibold text-ink">
                  8.7
                  <span className="type-caption font-normal text-ink-subtle"> / 10</span>
                </dd>
              </div>
            </dl>

            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <span className="type-caption text-ink-muted">Confidence</span>
                <span className="tabular type-caption font-semibold text-ink">94%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                <div className="h-full w-[94%] rounded-full bg-ai" />
              </div>
            </div>
          </div>

          {/* Community + progress */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-card border border-border bg-subtle/50 p-3">
              <p className="inline-flex items-center gap-1.5 type-caption text-ink-muted">
                <Users className="size-3.5" />
                Community
              </p>
              <p className="mt-1 tabular type-h4 text-ink">{formatNumber(342)}</p>
              <p className="type-caption text-ink-subtle">supporters</p>
            </div>

            <div className="rounded-card border border-border bg-subtle/50 p-3">
              <p className="inline-flex items-center gap-1.5 type-caption text-ink-muted">
                <TrendingUp className="size-3.5" />
                Progress
              </p>
              <p className="mt-1 tabular type-h4 text-ink">64%</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                <div className="h-full w-[64%] rounded-full bg-primary" />
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-subtle pt-3.5">
            <AvatarGroup
              size="xs"
              max={3}
              people={[
                { id: 'o1', name: 'Clean City Foundation' },
                { id: 'o2', name: 'Institute of Urban Systems' },
                { id: 'o3', name: 'Ward 12 Municipal Office' },
              ]}
            />
            <span className="type-caption text-ink-subtle">2 organisations working</span>
          </div>
        </div>
      </div>

      {/* ---- Orbiting card: map preview ------------------------------------ */}
      <div
        className={cn(
          'absolute -top-7 -right-5 hidden w-44 overflow-hidden rounded-card',
          'border border-border bg-surface shadow-raised sm:block lg:-right-12',
        )}
      >
        <MapPlaceholder className="h-24" label="Sector 12" />
        <p className="px-3 py-2 type-caption text-ink-muted">
          <span className="font-medium text-ink">3 reports</span> in this area
        </p>
      </div>

      {/* ---- Orbiting card: resolution status ------------------------------ */}
      <div
        className={cn(
          'absolute -bottom-8 -left-5 hidden w-52 rounded-card border border-border',
          'bg-surface p-3.5 shadow-raised sm:block lg:-left-14',
        )}
      >
        <span className="inline-flex items-center gap-1.5 type-overline text-success">
          <span className="size-1.5 rounded-full bg-success" />
          Resolved this week
        </span>
        <p className="mt-2 type-body-sm font-medium text-ink">
          Garbage accumulation, Block B
        </p>
        <p className="mt-1 type-caption text-ink-subtle">
          Verified by Ward 12 Municipal Office
        </p>
      </div>
    </div>
  );
}
