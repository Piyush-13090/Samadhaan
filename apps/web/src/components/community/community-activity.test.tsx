import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { ProblemFeed, ProblemListItem } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { CommunityActivity } from './community-activity';

const { fetchNearbyProblems } = vi.hoisted(() => ({ fetchNearbyProblems: vi.fn() }));
vi.mock('@/services/discovery.service', () => ({ fetchNearbyProblems }));

function item(overrides: Partial<ProblemListItem> = {}): ProblemListItem {
  return {
    publicId: 'SAM-1023',
    title: 'Large pothole near Sector 12 market',
    category: 'POTHOLES',
    subcategory: null,
    status: 'SUBMITTED',
    severity: 'HIGH',
    urgency: 'HIGH',
    area: 'Main Market Crossing',
    city: 'Gurugram',
    distanceMeters: null,
    voteCount: 127,
    commentCount: 12,
    thumbnailUrl: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    hasAiAnalysis: false,
    ...overrides,
  };
}

const feed = (items: ProblemListItem[]): ProblemFeed => ({
  items,
  nextCursor: null,
  origin: { kind: 'city', label: 'Gurugram', radiusMeters: null },
});

afterEach(() => vi.clearAllMocks());

describe('CommunityActivity', () => {
  it('starts with the most supported problems in the citizen’s city', async () => {
    fetchNearbyProblems.mockResolvedValue(feed([item()]));
    render(<CommunityActivity city="Gurugram" />);

    expect(
      await screen.findByText('Large pothole near Sector 12 market'),
    ).toBeInTheDocument();
    expect(fetchNearbyProblems).toHaveBeenCalledWith({
      city: 'Gurugram',
      sort: 'supported',
      limit: 4,
    });
  });

  it('switches to recently discussed, fetching each view once', async () => {
    fetchNearbyProblems
      .mockResolvedValueOnce(feed([item()]))
      .mockResolvedValueOnce(
        feed([item({ publicId: 'SAM-2', title: 'Overflowing drain' })]),
      );
    const user = userEvent.setup();
    render(<CommunityActivity city={null} />);
    await screen.findByText('Large pothole near Sector 12 market');

    await user.click(screen.getByRole('tab', { name: 'Recently discussed' }));
    expect(await screen.findByText('Overflowing drain')).toBeInTheDocument();
    expect(fetchNearbyProblems).toHaveBeenLastCalledWith({
      city: undefined,
      sort: 'discussed',
      limit: 4,
    });

    await user.click(screen.getByRole('tab', { name: 'Most supported' }));
    expect(fetchNearbyProblems).toHaveBeenCalledTimes(2);
  });

  it('says so honestly when nothing has been supported', async () => {
    fetchNearbyProblems.mockResolvedValue(feed([]));
    render(<CommunityActivity city="Gurugram" />);

    expect(
      await screen.findByText('No problems have been supported yet.'),
    ).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    fetchNearbyProblems
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(feed([item()]));
    const user = userEvent.setup();
    render(<CommunityActivity city="Gurugram" />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Large pothole near Sector 12 market'),
    ).toBeInTheDocument();
  });
});
