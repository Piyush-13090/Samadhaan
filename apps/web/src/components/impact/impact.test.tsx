import userEvent from '@testing-library/user-event';
import type {
  BadgeView,
  ImpactSummary,
  LeaderboardPage,
  ReputationView,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { ContributionHistory } from './contribution-history';
import { BadgeGrid, ImpactScoreCard, ReputationCard } from './impact-cards';
import { LeaderboardBoard } from './leaderboard-board';

const service = vi.hoisted(() => ({
  fetchImpact: vi.fn(),
  fetchReputation: vi.fn(),
  fetchBadges: vi.fn(),
  fetchContributions: vi.fn(),
  fetchLeaderboard: vi.fn(),
}));
vi.mock('@/services/impact.service', () => service);

const summary = (overrides: Partial<ImpactSummary> = {}): ImpactSummary => ({
  impactPoints: 1240,
  resolvedContributions: 7,
  tier: 'TRUSTED_CONTRIBUTOR',
  items: [
    {
      id: 't1',
      amount: 30,
      type: 'PROBLEM_RESOLVED',
      reason: 'Your report SAM-1023 was resolved',
      problem: { publicId: 'SAM-1023', title: 'Pothole' },
      ruleVersion: 'POINT_RULES_V1',
      createdAt: '2026-10-07T08:00:00.000Z',
    },
    {
      id: 't2',
      amount: -15,
      type: 'ADMIN_ADJUSTMENT',
      reason: 'Correction for a duplicate award.',
      problem: null,
      ruleVersion: 'POINT_RULES_V1',
      createdAt: '2026-10-06T08:00:00.000Z',
    },
  ],
  page: 1,
  limit: 20,
  totalCount: 2,
  totalPages: 1,
  ...overrides,
});

const reputation: ReputationView = {
  score: 82,
  tier: 'TRUSTED_CONTRIBUTOR',
  next: { tier: 'CIVIC_CHAMPION', pointsNeeded: 160, minimumReputation: 65 },
  impactPoints: 540,
  verifiedReports: 18,
  successfulContributions: 31,
  resolvedContributions: 7,
  updatedAt: null,
  note: 'An initial heuristic of contribution quality — not a validated measure of trustworthiness.',
};

beforeEach(() => vi.clearAllMocks());

describe('ContributionHistory', () => {
  it('lists every award with its reason, problem and rule version, and filters on the server', async () => {
    service.fetchImpact.mockResolvedValue(summary());
    renderWithProviders(<ContributionHistory />);
    expect(await screen.findByText('+30')).toBeInTheDocument();
    expect(screen.getByText('Problem resolved')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SAM-1023' })).toHaveAttribute(
      'href',
      '/problems/SAM-1023',
    );
    expect(screen.getByText('-15')).toBeInTheDocument();
    expect(screen.getByText('Correction')).toBeInTheDocument();
    expect(screen.getAllByText(/POINT_RULES_V1/)).toHaveLength(2);
    await userEvent.click(screen.getByRole('tab', { name: 'Resolutions' }));
    await waitFor(() =>
      expect(service.fetchImpact).toHaveBeenLastCalledWith('resolutions', 1),
    );
  });
});

describe('cards', () => {
  it('shows points and reputation with positive signals only', () => {
    renderWithProviders(
      <>
        <ImpactScoreCard
          impactPoints={1240}
          resolvedContributions={7}
          href="/profile/impact"
        />
        <ReputationCard reputation={reputation} />
      </>,
    );
    expect(screen.getByText('1,240')).toBeInTheDocument();
    expect(screen.getByText('Trusted Contributor')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText(/not a validated measure/)).toBeInTheDocument();
    expect(screen.getByText(/160 more points, reputation 65\+/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/rejected|spam|fraud/i);
  });

  it('shows earned badges first, and what earns the rest', () => {
    const badges: BadgeView[] = [
      {
        key: 'CIVIC_CHAMPION',
        name: 'Civic Champion',
        description: 'x',
        criteria: 'Civic Champion tier',
        earned: false,
        awardedAt: null,
      },
      {
        key: 'FIRST_REPORT',
        name: 'First Report',
        description: 'y',
        criteria: '1 verified report',
        earned: true,
        awardedAt: '2026-10-01T00:00:00.000Z',
      },
    ];
    renderWithProviders(<BadgeGrid badges={badges} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('First Report');
    expect(items[1]).toHaveTextContent('Civic Champion tier');
    expect(screen.getByText(/not yet earned/)).toBeInTheDocument();
  });
});

function board(overrides: Partial<LeaderboardPage> = {}): LeaderboardPage {
  return {
    period: 'month',
    filters: { city: null, state: null, category: null },
    items: [
      {
        rank: 1,
        user: { displayName: 'priya', name: 'priya', avatarUrl: null },
        impactPoints: 320,
        reputationScore: 78,
        reputationTier: 'TRUSTED_CONTRIBUTOR',
        resolvedContributions: 6,
        badges: [{ key: 'FIRST_REPORT', name: 'First Report' }],
        isViewer: false,
      },
    ],
    page: 1,
    limit: 20,
    totalCount: 1,
    totalPages: 1,
    viewer: {
      rank: 14,
      user: { displayName: 'me', name: 'me', avatarUrl: null },
      impactPoints: 40,
      reputationScore: 52,
      reputationTier: 'NEW_CONTRIBUTOR',
      resolvedContributions: 1,
      badges: [],
      isViewer: true,
    },
    generatedAt: '2026-10-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('LeaderboardBoard', () => {
  it('ranks server-side, shows quality beside points, and the viewer’s own position', async () => {
    service.fetchLeaderboard.mockResolvedValue(board());
    renderWithProviders(<LeaderboardBoard />);
    const list = await screen.findByRole('list', { name: 'Leaderboard' });
    expect(within(list).getByText('priya')).toBeInTheDocument();
    expect(within(list).getByText(/reputation 78/)).toBeInTheDocument();
    expect(within(list).getByText(/6 resolved/)).toBeInTheDocument();
    expect(within(list).getByText('320')).toBeInTheDocument();
    expect(screen.getByLabelText('Your position')).toHaveTextContent('14');
    expect(service.fetchLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({ period: 'month', page: 1 }),
      expect.any(AbortSignal),
    );
  });

  it('sends period and category filters to the server', async () => {
    service.fetchLeaderboard.mockResolvedValue(board({ viewer: null }));
    renderWithProviders(<LeaderboardBoard />);
    await screen.findByRole('list', { name: 'Leaderboard' });
    await userEvent.click(screen.getByRole('tab', { name: 'All time' }));
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'DRAINAGE');
    await waitFor(() =>
      expect(service.fetchLeaderboard).toHaveBeenLastCalledWith(
        expect.objectContaining({ period: 'all', category: 'DRAINAGE' }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('says plainly when there is nothing to rank', async () => {
    service.fetchLeaderboard.mockResolvedValue(
      board({ items: [], totalCount: 0, viewer: null }),
    );
    renderWithProviders(<LeaderboardBoard />);
    expect(await screen.findByText('No contributions yet')).toBeInTheDocument();
  });
});
