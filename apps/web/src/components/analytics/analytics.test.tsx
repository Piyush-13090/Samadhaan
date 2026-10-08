import userEvent from '@testing-library/user-event';
import type {
  AnalyticsAreas,
  AnalyticsCategories,
  AnalyticsCommunity,
  AnalyticsHotspots,
  AnalyticsInsightView,
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsRecurring,
  AnalyticsResolution,
  AnalyticsTrends,
  CitizenAnalytics,
  OrganizationAnalytics as OrganizationAnalyticsData,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { toAnalyticsQuery } from '@/lib/analytics';
import { CitizenImpact } from './citizen-impact';
import { GovernmentAnalytics } from './government-analytics';
import { OrganizationAnalytics } from './organization-analytics';

const service = vi.hoisted(() => ({
  fetchGovernmentAnalytics: vi.fn(),
  fetchLatestInsight: vi.fn(),
  generateInsight: vi.fn(),
  fetchOrganizationAnalytics: vi.fn(),
  fetchMyAnalytics: vi.fn(),
  analyticsExportUrl: vi.fn(
    (slug: string, query: object, dataset: string, format: string) =>
      `/export/${slug}/${dataset}.${format}?${new URLSearchParams(
        toAnalyticsQuery(query) as Record<string, string>,
      ).toString()}`,
  ),
}));
vi.mock('@/services/analytics.service', () => service);
vi.mock('@/components/map/civic-map', () => ({
  CivicMap: ({ label, aggregates }: { label: string; aggregates: unknown[] }) => (
    <div role="img" aria-label={label}>
      {aggregates.length} cells
    </div>
  ),
}));

const period: AnalyticsPeriod = {
  preset: '30d',
  from: '2026-09-09',
  to: '2026-10-08',
  timezone: 'Asia/Kolkata',
  granularity: 'day',
  previous: { from: '2026-08-10', to: '2026-09-08' },
};
const filters = {
  category: null,
  severity: null,
  status: null,
  priority: null,
  city: null,
  area: null,
};
const scoped = { period, filters, generatedAt: '2026-10-08T00:00:00.000Z' };
const metric = (key: string, value: number | null, changePct: number | null = null) => ({
  key,
  value,
  previous: 0,
  changePct,
});

const fixtures = {
  overview: {
    ...scoped,
    metrics: {
      reported: metric('reported', 42, 20),
      verified: metric('verified', 30, null),
      inProgress: metric('inProgress', 5),
      resolved: metric('resolved', 12),
      rejected: metric('rejected', 2),
      criticalHigh: metric('criticalHigh', 6),
      resolutionRate: metric('resolutionRate', 40),
      avgDaysToVerification: metric('avgDaysToVerification', null),
      medianDaysToVerification: metric('medianDaysToVerification', null),
      avgDaysToResolution: metric('avgDaysToResolution', 9.5),
      medianDaysToResolution: metric('medianDaysToResolution', 8),
      activeNow: metric('activeNow', 25),
    },
  } satisfies AnalyticsOverview,
  trends: {
    ...scoped,
    granularity: 'day',
    buckets: [
      {
        start: '2026-10-07',
        label: '7 Oct',
        reported: 3,
        verified: 1,
        resolved: 1,
        rejected: 0,
      },
      {
        start: '2026-10-08',
        label: '8 Oct',
        reported: 2,
        verified: 0,
        resolved: 0,
        rejected: 1,
      },
    ],
  } satisfies AnalyticsTrends,
  categories: {
    ...scoped,
    total: 42,
    categories: [
      {
        category: 'DRAINAGE',
        count: 15,
        share: 35.7,
        previous: 10,
        changePct: 50,
        direction: 'increasing',
        persistent: true,
      },
      {
        category: 'POTHOLES',
        count: 5,
        share: 11.9,
        previous: 2,
        changePct: null,
        direction: 'unknown',
        persistent: false,
      },
    ],
    subcategories: [],
    severity: [{ severity: 'HIGH', count: 6, share: 14.3 }],
    priority: [{ tier: 'UNASSESSED', count: 42, share: 100 }],
  } satisfies AnalyticsCategories,
  areas: {
    ...scoped,
    jurisdiction: { name: 'Ward 12', type: 'MUNICIPAL_CORPORATION', count: 42 },
    byState: [],
    byCity: [{ name: 'Gurugram', count: 40, open: 30, resolved: 10, suppressed: false }],
    byPostalCode: [
      { name: '122009', count: null, open: null, resolved: null, suppressed: true },
    ],
    minGroupSize: 3,
  } satisfies AnalyticsAreas,
  resolution: {
    ...scoped,
    summary: {
      avgDays: null,
      medianDays: null,
      fastestDays: null,
      longestOpenDays: 45,
      resolutionRate: 40,
      returnedVerifications: 1,
    },
    funnel: [
      { key: 'submitted', label: 'Submitted', count: 42, conversionPct: null },
      { key: 'review', label: 'Under review', count: 35, conversionPct: 83.3 },
      { key: 'verified', label: 'Verified', count: 30, conversionPct: 85.7 },
      { key: 'allocated', label: 'Allocated', count: 15, conversionPct: 50 },
      { key: 'inProgress', label: 'In progress', count: 14, conversionPct: 93.3 },
      { key: 'resolved', label: 'Resolved', count: 12, conversionPct: 85.7 },
    ],
    stages: [
      {
        key: 'allocation',
        label: 'Verified → allocated',
        avgDays: 6.2,
        medianDays: 5,
        observations: 15,
      },
    ],
    bottleneck: { key: 'allocation', label: 'Verified → allocated', avgDays: 6.2 },
    distribution: [{ bucket: '7–14 days', count: 4 }],
    byPriority: [],
    bySeverity: [],
  } satisfies AnalyticsResolution,
  community: {
    ...scoped,
    activeContributors: 9,
    reported: 42,
    verifiedReports: 30,
    confirmedDuplicates: 3,
    communitySupported: 20,
    contributionsToResolution: 14,
    impactPointsEarned: 600,
    outcome: {
      reports: 42,
      verified: 30,
      resolved: 12,
      avgDaysReportToVerification: null,
      avgDaysVerificationToResolution: null,
    },
  } satisfies AnalyticsCommunity,
  hotspots: {
    ...scoped,
    algorithmVersion: 'grid-zscore-v1',
    cellSizeKm: 0.56,
    cells: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [77.027, 28.459] },
        properties: {
          count: 6,
          severity: { LOW: 0, MEDIUM: 3, HIGH: 2, CRITICAL: 1 },
          topCategories: [],
        },
      },
    ],
    hotspots: [],
    occupiedCells: 3,
    note: 'Hotspots need reports in at least 5 grid cells to compare against.',
  } satisfies AnalyticsHotspots,
  recurring: {
    ...scoped,
    algorithmVersion: 'dbscan-300m-14d-v1',
    clusters: [],
  } satisfies AnalyticsRecurring,
};

const insight = (aiRan = true): AnalyticsInsightView => ({
  ...scoped,
  facts: [
    {
      key: 'category.DRAINAGE.change',
      label: 'Category: Drainage, vs previous period',
      value: '+50%',
    },
  ],
  summary: 'Drainage reports rose against the previous period.',
  observations: [
    { text: 'Drainage rose 50%.', metricKeys: ['category.DRAINAGE.change'] },
  ],
  attention: [],
  guidance: [
    {
      ref: 'G1',
      title: 'Monsoon drainage',
      sectionTitle: null,
      href: '/knowledge/sources/s#chunk-c',
    },
  ],
  guidanceNotes: [{ text: 'Guidance covers clearing inlets before rain.', refs: ['G1'] }],
  model: {
    provider: aiRan ? 'anthropic' : 'development',
    name: 'm',
    promptVersion: 'p',
    aiRan,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  service.fetchGovernmentAnalytics.mockImplementation(
    async (_slug: string, section: keyof typeof fixtures) => fixtures[section],
  );
  service.fetchLatestInsight.mockResolvedValue({ insight: null });
});

describe('GovernmentAnalytics', () => {
  it('shows real figures, and says so when there is not enough data', async () => {
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    expect(await screen.findByText('+20% vs previous period')).toBeInTheDocument();
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Comparison unavailable').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not enough data yet').length).toBeGreaterThan(0);
    // Every metric explains itself.
    expect(
      screen.getAllByRole('button', {
        name: /How resolution rate is measured: Resolved ÷ verified/,
      }).length,
    ).toBeGreaterThan(0);
  });

  it('pairs charts with accessible tables, and describes bottlenecks without causes', async () => {
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    const table = await screen.findByRole('table', { name: 'Trend by day' });
    expect(within(table).getByRole('rowheader', { name: '7 Oct' })).toBeInTheDocument();
    expect(
      await screen.findByText(/This shows where time is spent, not why/),
    ).toBeInTheDocument();
    expect(screen.getByText('Fewer than 3')).toBeInTheDocument(); // suppressed postal code
    expect(
      screen.getByRole('img', { name: 'Map of report density by grid cell' }),
    ).toHaveTextContent('1 cells');
    expect(screen.getByText(/at least 5 grid cells/)).toBeInTheDocument();
  });

  it('keeps working when one section fails', async () => {
    service.fetchGovernmentAnalytics.mockImplementation(
      async (_slug: string, section: keyof typeof fixtures) => {
        if (section === 'areas') throw new Error('boom');
        return fixtures[section];
      },
    );
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    expect(await screen.findByText('Areas could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Some sections could not be loaded',
    );
    expect(screen.getByText('+20% vs previous period')).toBeInTheDocument();
  });

  it('sends the period and filters, and waits for a complete custom range', async () => {
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    await screen.findByText('+20% vs previous period');
    await userEvent.click(screen.getByRole('tab', { name: '90 days' }));
    await waitFor(() =>
      expect(service.fetchGovernmentAnalytics).toHaveBeenLastCalledWith(
        'ward-12',
        expect.any(String),
        expect.objectContaining({ preset: '90d', timezone: 'Asia/Kolkata' }),
        expect.any(AbortSignal),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'DRAINAGE');
    await waitFor(() =>
      expect(service.fetchGovernmentAnalytics).toHaveBeenLastCalledWith(
        'ward-12',
        expect.any(String),
        expect.objectContaining({ category: 'DRAINAGE' }),
        expect.any(AbortSignal),
      ),
    );
    service.fetchGovernmentAnalytics.mockClear();
    await userEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.getByText('Choose both dates for a custom range.')).toBeInTheDocument();
    expect(service.fetchGovernmentAnalytics).not.toHaveBeenCalled();
  });

  it('offers exports for the same filters', async () => {
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    await screen.findByText('+20% vs previous period');
    await userEvent.selectOptions(screen.getByLabelText('Export'), 'problems');
    expect(screen.getByRole('link', { name: 'CSV' })).toHaveAttribute(
      'href',
      expect.stringContaining('/export/ward-12/problems.csv?preset=30d'),
    );
  });

  it('keeps observed data, AI interpretation and reference knowledge apart', async () => {
    service.generateInsight.mockResolvedValue({ insight: insight() });
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Generate summary' }),
    );
    const ai = await screen.findByRole('region', { name: 'AI interpretation' });
    expect(within(ai).getByText(/Drainage rose 50%/)).toBeInTheDocument();
    expect(
      within(ai).getByText(/based on Category: Drainage, vs previous period: \+50%/),
    ).toBeInTheDocument();
    const reference = screen.getByRole('region', { name: 'Reference knowledge' });
    expect(
      within(reference).getByRole('link', { name: /Monsoon drainage/ }),
    ).toHaveAttribute('href', '/knowledge/sources/s#chunk-c');
    expect(screen.getByText(/Observed data used \(1 figures\)/)).toBeInTheDocument();
  });

  it('labels a summary produced without a model', async () => {
    service.fetchLatestInsight.mockResolvedValue({ insight: insight(false) });
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    expect(await screen.findByText(/No model ran/)).toBeInTheDocument();
  });

  it('reports a failed summary without hiding the figures', async () => {
    service.generateInsight.mockRejectedValue(new Error('503'));
    renderWithProviders(<GovernmentAnalytics slug="ward-12" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Generate summary' }),
    );
    expect(
      await screen.findByText(/figures on this page are unaffected/),
    ).toBeInTheDocument();
    expect(screen.getByText('+20% vs previous period')).toBeInTheDocument();
  });
});

describe('OrganizationAnalytics', () => {
  it('shows the organisation’s own delivery, without rates on thin data', async () => {
    const data: OrganizationAnalyticsData = {
      period,
      generatedAt: scoped.generatedAt,
      problemsAssigned: 2,
      projectsActive: 1,
      projectsCompleted: 1,
      avgCompletionDays: null,
      onTimeRate: null,
      onTimeObservations: 1,
      tasksCompleted: 4,
      openTasks: 3,
      evidenceSubmitted: 2,
      evidenceApprovalRate: null,
      governmentApprovals: 1,
      trend: [
        { start: '2026-10-08', label: '8 Oct', tasksCompleted: 4, projectsCompleted: 1 },
      ],
    };
    service.fetchOrganizationAnalytics.mockResolvedValue(data);
    renderWithProviders(<OrganizationAnalytics slug="clean-city" />);
    expect(await screen.findByText('1 with a target date')).toBeInTheDocument();
    expect(screen.getAllByText('Not enough data yet')).toHaveLength(3);
    expect(document.body).not.toHaveTextContent(/rank/i);
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
  });
});

describe('CitizenImpact', () => {
  const mine: CitizenAnalytics = {
    reported: 7,
    verified: 4,
    resolved: 2,
    inProgress: 1,
    awaitingReview: 3,
    confirmedDuplicates: 0,
    medianDaysToResolution: null,
    supportersOnMyReports: 5,
    impactPoints: 70,
    generatedAt: scoped.generatedAt,
  };

  it('shows what happened to the citizen’s own reports', async () => {
    service.fetchMyAnalytics.mockResolvedValue(mine);
    renderWithProviders(<CitizenImpact />);
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Where my reports are now' }),
    ).toHaveTextContent('Being worked on');
    expect(
      screen.getByText(/5 people have supported your reports · 70 impact points/),
    ).toBeInTheDocument();
    expect(screen.getByText('Not enough data yet')).toBeInTheDocument();
  });

  it('has a plain empty state', async () => {
    service.fetchMyAnalytics.mockResolvedValue({ ...mine, reported: 0 });
    renderWithProviders(<CitizenImpact />);
    expect(
      await screen.findByText(/You have not reported a problem yet/),
    ).toBeInTheDocument();
  });
});

describe('toAnalyticsQuery', () => {
  it('drops empty filters and ignores dates outside a custom range', () => {
    expect(
      toAnalyticsQuery({
        preset: '7d',
        timezone: 'UTC',
        from: '2026-01-01',
        category: '',
        city: '  ',
      }),
    ).toEqual({ preset: '7d', timezone: 'UTC' });
    expect(
      toAnalyticsQuery({
        preset: 'custom',
        timezone: 'UTC',
        from: '2026-01-01',
        to: '2026-01-31',
        area: '411001',
      }),
    ).toEqual({
      preset: 'custom',
      timezone: 'UTC',
      from: '2026-01-01',
      to: '2026-01-31',
      area: '411001',
    });
  });
});
