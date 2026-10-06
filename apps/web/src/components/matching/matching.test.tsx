import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemMatches, ProblemOrganizationMatch } from '@samadhaan/shared';
import { ApiError } from '@/lib/api-error';
import { renderWithProviders as render, screen, within } from '@/test/render';
import { recommendationItem } from '@/test/workspace-fixtures';
import { OrganizationMatchCard } from './organization-match-card';
import { OrganizationOpportunityCard } from './organization-opportunity-card';
import { ProblemOrganizationMatches } from './problem-organization-matches';

const fetchProblemMatches = vi.hoisted(() => vi.fn());
vi.mock('@/services/matching.service', () => ({ fetchProblemMatches }));

function match(
  overrides: Partial<ProblemOrganizationMatch> = {},
): ProblemOrganizationMatch {
  return {
    organization: {
      slug: 'roadsafe-foundation',
      name: 'RoadSafe Foundation',
      type: 'NGO',
      logoUrl: null,
      verificationStatus: 'VERIFIED',
      location: { city: 'Gurugram', state: 'Haryana' },
    },
    relevance: 0.92,
    rank: 1,
    signals: {
      semantic: 0.91,
      expertise: 0.94,
      category: 1,
      geographic: 0.82,
      capability: 0.7,
      activity: 0.5,
    },
    reasons: [
      { code: 'EXPERTISE_STRONG', value: 0.94 },
      { code: 'WITHIN_SERVICE_AREA', value: 2400 },
      { code: 'SEMANTIC_HIGH', value: 0.91 },
    ],
    matchedExpertise: [
      { category: 'ROADS', subcategory: 'Road infrastructure', level: 'SPECIALIST' },
      { category: 'TRAFFIC', subcategory: 'Urban safety', level: 'EXPERIENCED' },
    ],
    computedAt: '2026-10-07T00:00:00.000Z',
    ...overrides,
  };
}

const page = (overrides: Partial<ProblemMatches> = {}): ProblemMatches => ({
  state: 'ready',
  matchingVersion: 'heuristic-baseline@1.0.0+abc',
  computedAt: '2026-10-07T00:00:00.000Z',
  items: [match()],
  ...overrides,
});

describe('OrganizationMatchCard', () => {
  it('shows who, how relevant, which expertise and why — from real signals', () => {
    render(<OrganizationMatchCard match={match()} />);
    const card = screen.getByRole('article');

    expect(
      within(card).getByRole('heading', { name: 'RoadSafe Foundation' }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent('NGO');
    expect(card).toHaveTextContent('Gurugram, Haryana');
    expect(card).toHaveTextContent('Verified');
    expect(card).toHaveTextContent('92% relevance');
    expect(card).toHaveTextContent('High relevance');
    expect(card).toHaveTextContent('Road infrastructure');
    expect(card).toHaveTextContent('Urban safety');
    expect(card).toHaveTextContent('Strong expertise in this kind of problem');
    expect(card).toHaveTextContent('2.4 km from this problem');
    expect(card).not.toHaveTextContent(/confidence/i);
    expect(within(card).getByRole('link', { name: /View organisation/ })).toHaveAttribute(
      'href',
      '/organizations/roadsafe-foundation',
    );
  });

  it('shows a pending organisation as such, without hiding it', () => {
    render(
      <OrganizationMatchCard
        match={match({
          organization: { ...match().organization, verificationStatus: 'PENDING' },
          relevance: 0.58,
        })}
      />,
    );
    expect(screen.getByRole('article')).toHaveTextContent('Pending verification');
    expect(screen.getByRole('article')).toHaveTextContent('Moderate relevance');
  });
});

describe('ProblemOrganizationMatches', () => {
  beforeEach(() => fetchProblemMatches.mockReset());

  it('loads, then lists the organisations with a clear disclaimer', async () => {
    let resolve!: (value: ProblemMatches) => void;
    fetchProblemMatches.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ProblemOrganizationMatches publicId="SAM-1023" />);

    expect(screen.getByLabelText('Loading organisations')).toBeInTheDocument();
    resolve(page());

    expect(await screen.findByText('RoadSafe Foundation')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Organisations that may be able to help' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/These are suggestions, not assignments/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will solve/i)).not.toBeInTheDocument();
  });

  it('says matching is under way when it has not finished', async () => {
    fetchProblemMatches.mockResolvedValue(page({ state: 'pending', items: [] }));
    render(<ProblemOrganizationMatches publicId="SAM-1023" />);
    expect(await screen.findByText('Looking for organisations')).toBeInTheDocument();
  });

  it('says so when nothing matched', async () => {
    fetchProblemMatches.mockResolvedValue(page({ items: [] }));
    render(<ProblemOrganizationMatches publicId="SAM-1023" />);
    expect(
      await screen.findByText('No closely matching organisations yet'),
    ).toBeInTheDocument();
  });

  it('renders nothing for a problem that is not open work', async () => {
    fetchProblemMatches.mockResolvedValue(page({ state: 'unavailable', items: [] }));
    const { container } = render(<ProblemOrganizationMatches publicId="SAM-1023" />);
    await vi.waitFor(() => expect(fetchProblemMatches).toHaveBeenCalled());
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows an error with a working retry', async () => {
    fetchProblemMatches
      .mockRejectedValueOnce(
        new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'x',
          status: 500,
          requestId: 'req-9',
        }),
      )
      .mockResolvedValueOnce(page());
    render(<ProblemOrganizationMatches publicId="SAM-1023" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load suggested organisations.");
    expect(alert).toHaveTextContent('req-9');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('RoadSafe Foundation')).toBeInTheDocument();
  });
});

describe('OrganizationOpportunityCard', () => {
  it('shows relevance, severity, classification, distance and reasons — no apply', () => {
    render(
      <OrganizationOpportunityCard
        item={recommendationItem({ title: 'Large pothole causing traffic disruption' })}
      />,
    );
    const card = screen.getByRole('article');

    expect(card).toHaveTextContent('SAM-1023');
    expect(card).toHaveTextContent('92% relevance');
    expect(card).toHaveTextContent('High');
    expect(card).toHaveTextContent('Potholes → Potholes');
    expect(card).toHaveTextContent('2.3 km away');
    expect(card).toHaveTextContent('Strong match with your expertise');
    expect(card).toHaveTextContent('2.4 km from your registered location');
    expect(within(card).getByRole('link', { name: /View problem/ })).toHaveAttribute(
      'href',
      '/problems/SAM-1023',
    );
    expect(card).not.toHaveTextContent(/apply|accept|assigned to you/i);
    expect(
      within(card).queryByRole('button', { name: /Not relevant/ }),
    ).not.toBeInTheDocument();
  });

  it('offers owners and admins "not relevant", and restore once dismissed', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <OrganizationOpportunityCard
        item={recommendationItem()}
        onDismiss={onDismiss}
        onRestore={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Not relevant/ }));
    expect(onDismiss).toHaveBeenCalled();

    const onRestore = vi.fn();
    rerender(
      <OrganizationOpportunityCard
        item={recommendationItem({}, { status: 'DISMISSED' })}
        onDismiss={vi.fn()}
        onRestore={onRestore}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(onRestore).toHaveBeenCalled();
  });

  it('marks a match being refreshed', () => {
    render(
      <OrganizationOpportunityCard item={recommendationItem({}, { status: 'STALE' })} />,
    );
    expect(screen.getByText('Being refreshed')).toBeInTheDocument();
  });
});
