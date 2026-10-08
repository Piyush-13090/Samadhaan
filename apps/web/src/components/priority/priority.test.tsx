import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type {
  GovernmentPriorityView,
  PriorityAssessmentView,
  PriorityFeatureKey,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewList } from '@/components/government/review-list';
import { ReviewQueueItem } from '@/components/government/review-queue-item';
import { PriorityBadge } from '@/components/problems/priority-badge';
import { ToastProvider } from '@/components/ui/toast';
import { describeActivity } from '@/lib/government';
import { queueItem } from '@/test/government-fixtures';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { searchParamsMock } from '../../../vitest.setup';
import { PriorityInsightCard } from './priority-insight-card';
import { PublicPriorityCard } from './public-priority-card';

const government = vi.hoisted(() => ({
  fetchPriority: vi.fn(),
  recalculatePriority: vi.fn(),
  overridePriority: vi.fn(),
  removePriorityOverride: vi.fn(),
  fetchGovernmentProblems: vi.fn(),
}));
vi.mock('@/services/government.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/government.service')>()),
  ...government,
}));
const problems = vi.hoisted(() => ({ fetchPublicPriority: vi.fn() }));
vi.mock('@/services/problems.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/problems.service')>()),
  ...problems,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const LABELS: Record<PriorityFeatureKey, string> = {
  severity: 'Severity',
  urgency: 'Urgency',
  communityImpact: 'Community impact',
  safetyRisk: 'Safety risk',
  geographicImpact: 'Geographic impact',
  recency: 'Recency',
  affectedPopulation: 'Affected population',
  evidence: 'Evidence',
};

function assessment(
  overrides: Partial<PriorityAssessmentView> = {},
): PriorityAssessmentView {
  return {
    id: 'a1',
    score: 74.2,
    tier: 'HIGH',
    confidence: 0.82,
    dataCompleteness: 0.9,
    provisional: false,
    reasons: [
      { kind: 'driver', feature: 'severity', text: 'High severity' },
      {
        kind: 'driver',
        feature: 'safetyRisk',
        text: 'Strong safety-risk signal: “live wire”',
      },
      {
        kind: 'warning',
        feature: 'affectedPopulation',
        text: 'Affected population unavailable — none is estimated',
      },
    ],
    breakdown: (Object.keys(LABELS) as PriorityFeatureKey[]).map((key) => ({
      key,
      label: LABELS[key],
      value: key === 'affectedPopulation' ? null : 0.7,
      confidence: key === 'affectedPopulation' ? 0 : 0.9,
      available: key !== 'affectedPopulation',
      weight: 0.125,
      contribution: key === 'affectedPopulation' ? 0 : 9.3,
      source: `${LABELS[key]} source`,
      evidence: [],
      note: key === 'affectedPopulation' ? 'no figure stated' : null,
    })),
    model: {
      scoringModel: 'heuristic',
      scoringVersion: 'priority-heuristic-v1',
      featureVersion: 'priority-features-v1',
      aiStatus: 'COMPLETED',
      aiModel: { name: 'claude-x', version: '1', promptVersion: 'p' },
    },
    guidance: [
      {
        sourceId: 's1',
        chunkId: 'c1',
        title: 'Electrical safety',
        sectionTitle: 'Isolation',
        href: '/knowledge/sources/s1#chunk-c1',
      },
    ],
    calculatedAt: '2026-10-07T08:00:00.000Z',
    confirmedAt: '2026-10-07T08:00:00.000Z',
    ...overrides,
  };
}

function view(overrides: Partial<GovernmentPriorityView> = {}): GovernmentPriorityView {
  return {
    assessment: assessment(),
    override: null,
    effective: { tier: 'HIGH', source: 'AI' },
    history: [
      {
        id: 'a1',
        score: 74,
        tier: 'HIGH',
        calculatedAt: '2026-10-07T08:00:00.000Z',
        trigger: 'engagement',
        changes: ['Tier medium → high.'],
      },
      {
        id: 'a0',
        score: 48,
        tier: 'MEDIUM',
        calculatedAt: '2026-10-05T08:00:00.000Z',
        trigger: 'analysis',
        changes: ['First assessment.'],
      },
    ],
    canOverride: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of [...searchParamsMock.keys()]) searchParamsMock.delete(key);
});

describe('PriorityInsightCard', () => {
  it('explains the tier: score, reasons, trust, history and guidance', async () => {
    government.fetchPriority.mockResolvedValue(view());
    render(<PriorityInsightCard slug="pune" publicId="SAM-1042" />);
    expect(await screen.findByText('74')).toBeInTheDocument();
    expect(screen.getByText(/High priority/)).toBeInTheDocument();
    expect(screen.getByText('High severity')).toBeInTheDocument();
    expect(screen.getByText(/Affected population unavailable/)).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText(/Tier medium → high/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Electrical safety/ })).toHaveAttribute(
      'href',
      '/knowledge/sources/s1#chunk-c1',
    );
    expect(screen.getByText(/does not change the score/)).toBeInTheDocument();
  });

  it('shows the component breakdown on request, with unavailable features marked', async () => {
    government.fetchPriority.mockResolvedValue(view());
    render(<PriorityInsightCard slug="pune" publicId="SAM-1042" />);
    const toggle = await screen.findByRole('button', { name: /View priority breakdown/ });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    const population = within(table)
      .getByRole('rowheader', { name: /Affected population/ })
      .closest('tr')!;
    expect(population).toHaveTextContent('Unavailable');
  });

  it('flags a provisional assessment', async () => {
    government.fetchPriority.mockResolvedValue(
      view({ assessment: assessment({ provisional: true, dataCompleteness: 0.45 }) }),
    );
    render(<PriorityInsightCard slug="pune" publicId="SAM-1042" />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Provisional/);
  });

  it('requires a reason to set the priority, then sends tier and reason only', async () => {
    government.fetchPriority.mockResolvedValue(view());
    government.overridePriority.mockResolvedValue(
      view({
        effective: { tier: 'CRITICAL', source: 'OVERRIDE' },
        override: {
          tier: 'CRITICAL',
          reason: 'School access road is required for evacuation.',
          organizationName: 'Pune MC',
          overriddenBy: 'Priya Mehta',
          overriddenAt: '2026-10-07T09:00:00.000Z',
          aiTierAtOverride: 'HIGH',
          aiScoreAtOverride: 74,
        },
      }),
    );
    render(<PriorityInsightCard slug="pune" publicId="SAM-1042" />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Set priority manually/ }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'CRITICAL');
    await userEvent.type(screen.getByLabelText(/Reason/), 'Too short');
    await userEvent.click(screen.getByRole('button', { name: 'Set priority' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 10 characters/);
    expect(government.overridePriority).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText(/Reason/));
    await userEvent.type(
      screen.getByLabelText(/Reason/),
      'School access road is required for evacuation.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Set priority' }));
    await waitFor(() =>
      expect(government.overridePriority).toHaveBeenCalledWith('pune', 'SAM-1042', {
        tier: 'CRITICAL',
        reason: 'School access road is required for evacuation.',
      }),
    );
    // Both stay visible: the decision and the AI estimate beside it.
    expect(await screen.findByText(/Set by Pune MC/)).toBeInTheDocument();
    expect(screen.getByText(/AI estimate: High/)).toBeInTheDocument();
    expect(screen.getByText(/the AI estimate was high \(74\)/)).toBeInTheDocument();
  });

  it('removes an override', async () => {
    government.fetchPriority.mockResolvedValue(
      view({
        effective: { tier: 'LOW', source: 'OVERRIDE' },
        override: {
          tier: 'LOW',
          reason: 'Duplicate of a funded works order.',
          organizationName: 'Pune MC',
          overriddenBy: null,
          overriddenAt: '2026-10-07T09:00:00.000Z',
          aiTierAtOverride: 'HIGH',
          aiScoreAtOverride: 74,
        },
      }),
    );
    government.removePriorityOverride.mockResolvedValue(view());
    render(<PriorityInsightCard slug="pune" publicId="SAM-1042" />);
    await userEvent.click(await screen.findByRole('button', { name: /Remove override/ }));
    await waitFor(() =>
      expect(government.removePriorityOverride).toHaveBeenCalledWith(
        'pune',
        'SAM-1042',
        undefined,
      ),
    );
  });

  it('says plainly when no assessment exists yet', async () => {
    government.fetchPriority.mockResolvedValue(
      view({ assessment: null, history: [], effective: { tier: null, source: null } }),
    );
    render(<PriorityInsightCard slug="pune" publicId="SAM-1042" />);
    expect(await screen.findByText(/Not assessed yet/)).toBeInTheDocument();
    expect(screen.getByText('Priority not assessed')).toBeInTheDocument();
  });
});

describe('PublicPriorityCard', () => {
  it('shows an attention level and plain reasons — no score', async () => {
    problems.fetchPublicPriority.mockResolvedValue({
      level: 'HIGH',
      reasons: ['High severity', 'Significant community support'],
      assessedAt: '2026-10-07T08:00:00.000Z',
    });
    render(<PublicPriorityCard publicId="SAM-1042" />);
    expect(await screen.findByText('Attention level')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Significant community support')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/score|confidence/i);
  });

  it('renders nothing before verification', async () => {
    problems.fetchPublicPriority.mockResolvedValue({
      level: null,
      reasons: [],
      assessedAt: null,
    });
    const { container } = render(<PublicPriorityCard publicId="SAM-1042" />);
    await waitFor(() => expect(problems.fetchPublicPriority).toHaveBeenCalled());
    expect(container).not.toHaveTextContent('Attention level');
  });
});

describe('queue', () => {
  it('distinguishes an official’s decision from an AI estimate', () => {
    renderWithProviders(<PriorityBadge tier="CRITICAL" overridden />);
    expect(screen.getByText(/set by a government official/)).toBeInTheDocument();
    renderWithProviders(<PriorityBadge tier="MEDIUM" provisional />);
    expect(screen.getByText(/Medium priority \(provisional\)/)).toBeInTheDocument();
  });

  it('shows priority, score, reasons and data confidence on a card', () => {
    renderWithProviders(
      <ReviewQueueItem
        slug="pune"
        item={queueItem({
          priority: {
            tier: 'CRITICAL',
            aiTier: 'HIGH',
            score: 74,
            overridden: true,
            confidence: 0.82,
            dataCompleteness: 0.91,
            provisional: false,
            summary: ['High severity', 'Multiple related reports'],
          },
        })}
      />,
    );
    expect(screen.getByText(/Critical priority/)).toBeInTheDocument();
    expect(screen.getByText(/Score 74 · AI high/)).toBeInTheDocument();
    expect(
      screen.getByText('High severity · Multiple related reports'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Confidence 82% · data 91% complete/)).toBeInTheDocument();
  });

  it('defaults to priority order and groups by tier without hiding any report', async () => {
    const tiers = ['CRITICAL', 'HIGH', 'HIGH', 'LOW', null] as const;
    government.fetchGovernmentProblems.mockResolvedValue({
      items: tiers.map((tier, i) =>
        queueItem({
          publicId: `SAM-${100 + i}`,
          title: `Report ${i}`,
          priority: {
            ...queueItem().priority,
            tier,
            aiTier: tier,
            score: tier ? 90 - i * 10 : null,
          },
        }),
      ),
      page: 1,
      limit: 20,
      totalCount: 5,
      totalPages: 1,
    });
    render(<ReviewList slug="pune" />);
    await screen.findByText('Report 0');
    expect(government.fetchGovernmentProblems.mock.calls[0]![1]).toMatchObject({
      sort: 'priority',
    });
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
        .filter((t) =>
          ['Critical', 'High', 'Medium', 'Low', 'Not yet assessed'].includes(t ?? ''),
        ),
    ).toEqual(['Critical', 'High', 'Low', 'Not yet assessed']);
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('filters by priority from the URL', async () => {
    searchParamsMock.set('priority', 'CRITICAL');
    government.fetchGovernmentProblems.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      totalCount: 0,
      totalPages: 1,
    });
    render(<ReviewList slug="pune" />);
    await waitFor(() => expect(government.fetchGovernmentProblems).toHaveBeenCalled());
    expect(government.fetchGovernmentProblems.mock.calls[0]![1]).toMatchObject({
      priority: 'CRITICAL',
    });
  });

  it('describes override activity', () => {
    expect(
      describeActivity({
        id: 'x',
        kind: 'PRIORITY_OVERRIDE_CREATED',
        organizationName: 'Pune MC',
        problemPublicId: 'SAM-1042',
        problemTitle: 't',
        fromStatus: null,
        toStatus: null,
        fromPriority: 'HIGH',
        toPriority: 'CRITICAL',
        actor: { name: 'Priya', kind: 'TEAM' },
        createdAt: '2026-10-07T08:00:00.000Z',
      }),
    ).toBe('SAM-1042 priority set to critical');
  });
});
