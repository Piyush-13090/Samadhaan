'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import {
  ANALYTICS_EXPORT_DATASETS,
  type AnalyticsExportDataset,
  type AnalyticsHotspots,
} from '@samadhaan/shared';
import { CivicMap } from '@/components/map/civic-map';
import { NativeSelect } from '@/components/project/native-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import {
  DEFAULT_ANALYTICS_QUERY,
  NOT_ENOUGH_DATA,
  formatValue,
  humanise,
  isCustomIncomplete,
  toAnalyticsQuery,
  type AnalyticsQuery,
} from '@/lib/analytics';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import {
  analyticsExportUrl,
  fetchGovernmentAnalytics,
  type GovernmentAnalyticsSection,
  type GovernmentAnalyticsSections,
} from '@/services/analytics.service';
import { AnalyticsFilters } from './analytics-filters';
import {
  AnalyticsSection,
  BarList,
  DataTable,
  MetricCard,
  MetricHelp,
  NotEnoughData,
  SeriesChart,
} from './analytics-primitives';
import { InsightPanel } from './insight-panel';
import { useAnalytics } from './use-analytics';

const DATASET_LABEL: Record<AnalyticsExportDataset, string> = {
  overview: 'Key metrics',
  trends: 'Trends',
  categories: 'Categories',
  areas: 'Areas',
  resolution: 'Resolution',
  problems: 'Problem list (public fields)',
};

const categoryLabel = (c: string) =>
  CATEGORY_DISPLAY[c as keyof typeof CATEGORY_DISPLAY]?.label ?? humanise(c);

/**
 * The government analytics command centre (Prompt 24). Every figure comes
 * from the API, computed over this office's jurisdiction; empty or thin data
 * says so instead of showing a number.
 */
export function GovernmentAnalytics({ slug }: { slug: string }) {
  const [query, setQuery] = useState<AnalyticsQuery>(DEFAULT_ANALYTICS_QUERY);
  const ready = !isCustomIncomplete(query);
  const key = ready ? JSON.stringify(toAnalyticsQuery(query)) : null;

  const load =
    <K extends GovernmentAnalyticsSection>(section: K) =>
    (signal: AbortSignal) =>
      fetchGovernmentAnalytics(slug, section, query, signal);
  const id = (section: GovernmentAnalyticsSection) => key && `${section}:${key}`;
  const overview = useAnalytics<GovernmentAnalyticsSections['overview']>(
    id('overview'),
    load('overview'),
  );
  const trends = useAnalytics<GovernmentAnalyticsSections['trends']>(
    id('trends'),
    load('trends'),
  );
  const categories = useAnalytics<GovernmentAnalyticsSections['categories']>(
    id('categories'),
    load('categories'),
  );
  const areas = useAnalytics<GovernmentAnalyticsSections['areas']>(
    id('areas'),
    load('areas'),
  );
  const resolution = useAnalytics<GovernmentAnalyticsSections['resolution']>(
    id('resolution'),
    load('resolution'),
  );
  const community = useAnalytics<GovernmentAnalyticsSections['community']>(
    id('community'),
    load('community'),
  );
  const hotspots = useAnalytics<GovernmentAnalyticsSections['hotspots']>(
    id('hotspots'),
    load('hotspots'),
  );
  const recurring = useAnalytics<GovernmentAnalyticsSections['recurring']>(
    id('recurring'),
    load('recurring'),
  );

  const failed = [
    overview,
    trends,
    categories,
    areas,
    resolution,
    community,
    hotspots,
    recurring,
  ].filter((s) => s.state.status === 'error').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="type-h2 text-ink">Civic analytics</h1>
          <p className="mt-1 max-w-2xl type-body-sm text-ink-muted">
            Aggregates over problems in your jurisdiction. Dates are grouped in the
            selected time zone. Where there is too little data, the page says so rather
            than showing a number.
          </p>
        </div>
        {key && <ExportControl slug={slug} query={query} />}
      </header>

      <Card>
        <CardBody>
          <AnalyticsFilters query={query} onChange={setQuery} />
          {!ready && (
            <p className="mt-2 type-body-sm text-ink-subtle">
              Choose both dates for a custom range.
            </p>
          )}
        </CardBody>
      </Card>

      {failed > 0 && failed < 8 && (
        <p role="status" className="type-body-sm text-warning">
          Some sections could not be loaded. The rest of the page is up to date.
        </p>
      )}

      {/* ------------------------------------------------------- KPIs */}
      <AnalyticsSection
        title="Key metrics"
        description={
          overview.state.status === 'ok'
            ? `${overview.state.data.period.from} to ${overview.state.data.period.to} · compared with ${overview.state.data.period.previous.from} to ${overview.state.data.period.previous.to}`
            : undefined
        }
        state={overview.state}
        onRetry={overview.retry}
      >
        {({ metrics: m }) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              metric="reported"
              value={m.reported.value}
              change={m.reported.changePct}
            />
            <MetricCard
              metric="verified"
              value={m.verified.value}
              change={m.verified.changePct}
            />
            <MetricCard metric="activeNow" value={m.activeNow.value} />
            <MetricCard
              metric="resolved"
              value={m.resolved.value}
              change={m.resolved.changePct}
            />
            <MetricCard metric="resolutionRate" value={m.resolutionRate.value} unit="%" />
            <MetricCard
              metric="criticalHigh"
              value={m.criticalHigh.value}
              change={m.criticalHigh.changePct}
            />
            <MetricCard
              metric="medianDaysToVerification"
              value={m.medianDaysToVerification.value}
              unit="days"
            />
            <MetricCard
              metric="avgDaysToResolution"
              value={m.avgDaysToResolution.value}
              unit="days"
            />
          </div>
        )}
      </AnalyticsSection>

      <InsightPanel slug={slug} query={query} queryKey={key ?? ''} />

      {/* ------------------------------------------------------- Trends */}
      <AnalyticsSection
        title="Trends"
        description="Events counted when they happened: reports filed, first verifications, rejections and resolutions."
        state={trends.state}
        onRetry={trends.retry}
        isEmpty={(d) =>
          d.buckets.every((b) => b.reported + b.verified + b.resolved + b.rejected === 0)
        }
      >
        {(d) => (
          <>
            <SeriesChart
              buckets={d.buckets}
              series={[
                {
                  key: 'reported',
                  label: 'Reported',
                  className: 'fill-primary/70 bg-primary/70',
                },
                { key: 'verified', label: 'Verified', className: 'fill-info bg-info' },
                {
                  key: 'resolved',
                  label: 'Resolved',
                  className: 'fill-success bg-success',
                },
              ]}
            />
            <DataTable
              visuallyHidden
              caption={`Trend by ${d.granularity}`}
              columns={[
                { key: 'label', label: humanise(d.granularity) },
                { key: 'reported', label: 'Reported', numeric: true },
                { key: 'verified', label: 'Verified', numeric: true },
                { key: 'resolved', label: 'Resolved', numeric: true },
                { key: 'rejected', label: 'Rejected', numeric: true },
              ]}
              rows={d.buckets.map((b) => ({ ...b }))}
            />
          </>
        )}
      </AnalyticsSection>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --------------------------------------------------- Categories */}
        <AnalyticsSection
          title="Categories"
          description="Share of reports, and change against the previous period of the same length."
          state={categories.state}
          onRetry={categories.retry}
          isEmpty={(d) => d.total === 0}
        >
          {(d) => (
            <div className="space-y-4">
              <BarList
                label="Reports by category"
                rows={d.categories
                  .filter((c) => c.count > 0)
                  .map((c) => ({
                    key: c.category,
                    label: categoryLabel(c.category),
                    value: c.count,
                    note: `${c.share}%`,
                  }))}
              />
              <DataTable
                caption="Category change against the previous period"
                columns={[
                  { key: 'category', label: 'Category' },
                  { key: 'count', label: 'This period', numeric: true },
                  { key: 'previous', label: 'Previous', numeric: true },
                  { key: 'change', label: 'Change' },
                ]}
                rows={d.categories.map((c) => ({
                  category: (
                    <>
                      {categoryLabel(c.category)}
                      {c.persistent && (
                        <Badge tone="neutral" size="sm" className="ml-2">
                          Persistent
                        </Badge>
                      )}
                    </>
                  ),
                  count: c.count,
                  previous: c.previous,
                  change:
                    c.changePct === null
                      ? 'Comparison unavailable'
                      : `${c.changePct > 0 ? '+' : ''}${c.changePct}% (${c.direction})`,
                }))}
              />
            </div>
          )}
        </AnalyticsSection>

        {/* ----------------------------------------- Severity & priority */}
        <AnalyticsSection
          title="Severity and priority"
          description="Severity as reported; priority as the effective tier (an official's override, else the AI tier)."
          state={categories.state}
          onRetry={categories.retry}
          isEmpty={(d) => d.total === 0}
        >
          {(d) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <BarList
                label="Reports by severity"
                rows={d.severity.map((s) => ({
                  key: s.severity,
                  label: humanise(s.severity),
                  value: s.count,
                }))}
              />
              <BarList
                label="Reports by priority"
                rows={d.priority.map((p) => ({
                  key: p.tier,
                  label: humanise(p.tier),
                  value: p.count,
                }))}
              />
            </div>
          )}
        </AnalyticsSection>
      </div>

      {/* ------------------------------------------------------- Resolution */}
      <AnalyticsSection
        title="Resolution"
        description="For problems reported in the period. Stage times use recorded status changes; records without them are left out, not estimated."
        state={resolution.state}
        onRetry={resolution.retry}
        isEmpty={(d) => d.funnel[0]!.count === 0}
      >
        {(d) => (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                metric="avgDaysToResolution"
                value={d.summary.avgDays}
                unit="days"
              />
              <MetricCard
                metric="medianDaysToResolution"
                value={d.summary.medianDays}
                unit="days"
              />
              <MetricCard
                metric="fastestDays"
                value={d.summary.fastestDays}
                unit="days"
              />
              <MetricCard
                metric="longestOpenDays"
                value={d.summary.longestOpenDays}
                unit="days"
              />
              <MetricCard
                metric="resolutionRate"
                value={d.summary.resolutionRate}
                unit="%"
              />
              <MetricCard
                metric="returnedVerifications"
                value={d.summary.returnedVerifications}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 type-body-sm font-medium text-ink">
                  Workflow funnel
                </h3>
                <BarList
                  label="Problems reaching each stage"
                  rows={d.funnel.map((s) => ({
                    key: s.key,
                    label: s.label,
                    value: s.count,
                    note:
                      s.conversionPct === null
                        ? undefined
                        : `${s.conversionPct}% of previous`,
                  }))}
                />
              </div>
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 type-body-sm font-medium text-ink">
                  Time in each stage
                  <MetricHelp
                    metric="stages"
                    text="Average days between recorded stage changes. A stage needs at least three observations."
                  />
                </h3>
                <DataTable
                  caption="Average and median days per stage"
                  columns={[
                    { key: 'label', label: 'Stage' },
                    { key: 'avg', label: 'Average', numeric: true },
                    { key: 'median', label: 'Median', numeric: true },
                    { key: 'n', label: 'Observed', numeric: true },
                  ]}
                  rows={d.stages.map((s) => ({
                    label: s.label,
                    avg: formatValue(s.avgDays, 'days'),
                    median: formatValue(s.medianDays, 'days'),
                    n: s.observations,
                  }))}
                />
                <p className="mt-2 type-body-sm text-ink-muted">
                  {d.bottleneck
                    ? `Most time is spent in “${d.bottleneck.label}” (${formatValue(d.bottleneck.avgDays, 'days')} on average). This shows where time is spent, not why.`
                    : 'No stage stands out yet — not enough recorded stage changes.'}
                </p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <div>
                <h3 className="mb-2 type-body-sm font-medium text-ink">
                  Time to resolution
                </h3>
                {d.distribution.every((b) => b.count === 0) ? (
                  <NotEnoughData />
                ) : (
                  <BarList
                    label="Resolved problems by days to resolution"
                    rows={d.distribution.map((b) => ({
                      key: b.bucket,
                      label: b.bucket,
                      value: b.count,
                    }))}
                  />
                )}
              </div>
              <div className="lg:col-span-2">
                <h3 className="mb-2 type-body-sm font-medium text-ink">
                  By priority and severity
                </h3>
                <DataTable
                  caption="Resolution by priority tier"
                  columns={[
                    { key: 'tier', label: 'Priority' },
                    { key: 'count', label: 'Reported', numeric: true },
                    { key: 'resolved', label: 'Resolved', numeric: true },
                    { key: 'rate', label: 'Resolution rate', numeric: true },
                    { key: 'median', label: 'Median days', numeric: true },
                    { key: 'open', label: 'Open now', numeric: true },
                  ]}
                  rows={d.byPriority.map((p) => ({
                    tier: humanise(p.tier),
                    count: p.count,
                    resolved: p.resolved,
                    rate: formatValue(p.resolutionRate, '%'),
                    median: formatValue(p.medianDays),
                    open: p.openNow,
                  }))}
                />
                <p className="mt-2 type-caption text-ink-subtle">
                  Differences between tiers or severities are observations, not evidence
                  that one causes the other.
                </p>
              </div>
            </div>
          </div>
        )}
      </AnalyticsSection>

      {/* ------------------------------------------------------- Geography */}
      <div className="grid gap-6 lg:grid-cols-2">
        <HotspotSection state={hotspots.state} onRetry={hotspots.retry} />
        <AnalyticsSection
          title="Areas"
          description="Areas with fewer than three reports are shown without counts, to protect privacy."
          state={areas.state}
          onRetry={areas.retry}
          isEmpty={(d) => d.jurisdiction.count === 0}
        >
          {(d) => (
            <div className="space-y-4">
              <p className="type-body-sm text-ink-muted">
                {d.jurisdiction.name}: {formatValue(d.jurisdiction.count)} reports in the
                period.
              </p>
              {(
                [
                  ['City', d.byCity],
                  ['Postal code', d.byPostalCode],
                ] as const
              ).map(([label, rows]) => (
                <DataTable
                  key={label}
                  caption={`Reports by ${label.toLowerCase()}`}
                  columns={[
                    { key: 'name', label },
                    { key: 'count', label: 'Reports', numeric: true },
                    { key: 'open', label: 'Open', numeric: true },
                    { key: 'resolved', label: 'Resolved', numeric: true },
                  ]}
                  rows={rows.slice(0, 10).map((r) => ({
                    name: r.name,
                    count: r.suppressed ? `Fewer than ${d.minGroupSize}` : r.count,
                    open: r.suppressed ? '—' : r.open,
                    resolved: r.suppressed ? '—' : r.resolved,
                  }))}
                />
              ))}
            </div>
          )}
        </AnalyticsSection>
      </div>

      <AnalyticsSection
        title="Recurring problems"
        description="The same kind of problem reported again and again in one place (3+ reports within ~300 m, from 2+ people, over 14+ days). Confirmed duplicates are excluded."
        state={recurring.state}
        onRetry={recurring.retry}
        isEmpty={(d) => d.clusters.length === 0}
        emptyText="No recurring problems detected in this period."
      >
        {(d) => (
          <DataTable
            caption="Recurring problem clusters"
            columns={[
              { key: 'category', label: 'Category' },
              { key: 'area', label: 'Area' },
              { key: 'reports', label: 'Reports', numeric: true },
              { key: 'people', label: 'People', numeric: true },
              { key: 'span', label: 'Over', numeric: true },
              { key: 'open', label: 'Open', numeric: true },
            ]}
            rows={d.clusters.map((c) => ({
              category: categoryLabel(c.category),
              area: c.area ?? '—',
              reports: c.reports,
              people: c.distinctReporters,
              span: `${c.spanDays} days (${c.firstReported} – ${c.lastReported})`,
              open: c.open,
            }))}
          />
        )}
      </AnalyticsSection>

      {/* ------------------------------------------------------- Community */}
      <AnalyticsSection
        title="Community impact"
        description="Participation in your jurisdiction, from confirmed outcomes only. No one is named."
        state={community.state}
        onRetry={community.retry}
      >
        {(d) => (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              metric="activeContributors"
              value={d.activeContributors}
              hint="People credited with impact points"
            />
            <MetricCard metric="verifiedReports" value={d.verifiedReports} />
            <MetricCard metric="confirmedDuplicates" value={d.confirmedDuplicates} />
            <MetricCard
              metric="communitySupported"
              value={d.communitySupported}
              hint="Reports with at least one supporter"
            />
            <MetricCard
              metric="contributionsToResolution"
              value={d.contributionsToResolution}
            />
            <MetricCard
              metric="avgDaysReportToVerification"
              value={d.outcome.avgDaysReportToVerification}
              unit="days"
            />
          </div>
        )}
      </AnalyticsSection>
    </div>
  );
}

function HotspotSection({
  state,
  onRetry,
}: {
  state: Parameters<typeof AnalyticsSection<AnalyticsHotspots>>[0]['state'];
  onRetry: () => void;
}) {
  return (
    <AnalyticsSection
      title="Hotspots"
      description="Grid cells (~0.5 km) where weighted report density is well above the rest of the jurisdiction. Locations are rounded."
      state={state}
      onRetry={onRetry}
      isEmpty={(d) => d.occupiedCells === 0}
    >
      {(d) => {
        const first = d.cells[0]?.geometry.coordinates;
        return (
          <div className="space-y-3">
            {d.cells.length > 0 && first && (
              <CivicMap
                className="h-64 rounded-control"
                label="Map of report density by grid cell"
                initialCenter={{ latitude: first[1], longitude: first[0] }}
                initialZoom={12}
                aggregates={d.cells}
                fallbackHint="The same cells are listed in the table below."
              />
            )}
            {d.note && <p className="type-body-sm text-ink-subtle">{d.note}</p>}
            {d.hotspots.length === 0 ? (
              <NotEnoughData>
                {d.note
                  ? NOT_ENOUGH_DATA
                  : 'No cell stands out from the rest of the jurisdiction.'}
              </NotEnoughData>
            ) : (
              <DataTable
                caption="Hotspot cells"
                columns={[
                  { key: 'place', label: 'Near' },
                  { key: 'count', label: 'Reports', numeric: true },
                  { key: 'open', label: 'Open', numeric: true },
                  { key: 'category', label: 'Most reported' },
                  { key: 'z', label: 'Above typical (σ)', numeric: true },
                  { key: 'confidence', label: 'Confidence', numeric: true },
                ]}
                rows={d.hotspots.map((h) => ({
                  place: h.label ?? `${h.latitude}, ${h.longitude}`,
                  count: h.problemCount,
                  open: h.openCount,
                  category: h.topCategory ? categoryLabel(h.topCategory) : '—',
                  z: h.zScore,
                  confidence: `${Math.round(h.confidence * 100)}%`,
                }))}
              />
            )}
            <p className="type-caption text-ink-subtle">
              Algorithm {d.algorithmVersion}.
            </p>
          </div>
        );
      }}
    </AnalyticsSection>
  );
}

function ExportControl({ slug, query }: { slug: string; query: AnalyticsQuery }) {
  const [dataset, setDataset] = useState<AnalyticsExportDataset>('overview');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Export">
        <NativeSelect
          value={dataset}
          onChange={(e) => setDataset(e.target.value as AnalyticsExportDataset)}
        >
          {ANALYTICS_EXPORT_DATASETS.map((d) => (
            <option key={d} value={d}>
              {DATASET_LABEL[d]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {(['csv', 'json'] as const).map((format) => (
        <a
          key={format}
          href={analyticsExportUrl(slug, query, dataset, format)}
          className="inline-flex h-10 items-center gap-1.5 rounded-control border border-border-strong bg-surface px-3 type-body-sm text-ink hover:bg-subtle"
          download
        >
          <Download className="size-4" aria-hidden="true" />
          {format.toUpperCase()}
        </a>
      ))}
    </div>
  );
}
