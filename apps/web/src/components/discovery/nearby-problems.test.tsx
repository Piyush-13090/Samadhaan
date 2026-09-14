import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProblemFeed, ProblemListItem } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { NearbyProblems } from './nearby-problems';

const { fetchNearbyProblems } = vi.hoisted(() => ({ fetchNearbyProblems: vi.fn() }));
vi.mock('@/services/discovery.service', () => ({ fetchNearbyProblems }));

/** Drives the geolocation hook without touching the real browser API. */
const geolocation = vi.hoisted(() => ({
  grant: true,
  calls: 0,
}));

vi.mock('@/hooks/use-geolocation', () => ({
  useGeolocation: () => ({
    status: 'idle' as const,
    position: null,
    error: geolocation.grant ? null : 'Location access was blocked.',
    request: vi.fn(async () => {
      geolocation.calls += 1;
      return geolocation.grant
        ? { latitude: 28.4595, longitude: 77.0266, accuracyMeters: 12 }
        : null;
    }),
    reset: vi.fn(),
  }),
}));

function item(overrides: Partial<ProblemListItem> = {}): ProblemListItem {
  return {
    publicId: 'SAM-1023',
    title: 'Large pothole near Sector 12 market',
    category: 'POTHOLES',
    subcategory: 'Road surface failure',
    status: 'UNDER_REVIEW',
    severity: 'HIGH',
    urgency: 'HIGH',
    area: 'Main Market Crossing',
    city: 'Gurugram',
    distanceMeters: 350,
    voteCount: 214,
    commentCount: 3,
    thumbnailUrl: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    hasAiAnalysis: true,
    ...overrides,
  };
}

function feed(overrides: Partial<ProblemFeed> = {}): ProblemFeed {
  return {
    items: [item()],
    nextCursor: null,
    origin: { kind: 'city', label: 'Gurugram', radiusMeters: null },
    ...overrides,
  };
}

describe('NearbyProblems', () => {
  beforeEach(() => {
    fetchNearbyProblems.mockReset();
    geolocation.grant = true;
    geolocation.calls = 0;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================== no location

  describe('with no location at all', () => {
    it('asks for one instead of showing an empty feed', () => {
      render(<NearbyProblems profileCity={null} />);

      expect(
        screen.getByText(/Set your location to discover civic issues around you/),
      ).toBeInTheDocument();
      expect(screen.getByText('No location set')).toBeInTheDocument();
    });

    // A permission prompt nobody asked for teaches people to refuse it.
    it('does not request the device location on its own', () => {
      render(<NearbyProblems profileCity={null} />);

      expect(geolocation.calls).toBe(0);
      expect(fetchNearbyProblems).not.toHaveBeenCalled();
    });

    it('offers both the device and the profile as ways forward', () => {
      render(<NearbyProblems profileCity={null} />);

      expect(
        screen.getAllByRole('button', { name: /Use my location/i }).length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: /Add my city/i })).toHaveAttribute(
        'href',
        '/profile',
      );
    });

    it('searches once the device location is granted', async () => {
      const user = userEvent.setup();
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity={null} />);

      await user.click(screen.getAllByRole('button', { name: /Use my location/i })[0]!);

      await waitFor(() => expect(fetchNearbyProblems).toHaveBeenCalled());
      expect(fetchNearbyProblems.mock.calls[0]![0]).toMatchObject({
        latitude: 28.4595,
        longitude: 77.0266,
      });
    });
  });

  // ================================================================ city mode

  describe('falling back to the profile city', () => {
    it('searches the city and says so', async () => {
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);

      await waitFor(() => expect(fetchNearbyProblems).toHaveBeenCalled());
      expect(fetchNearbyProblems.mock.calls[0]![0]).toMatchObject({ city: 'Gurugram' });
      expect(screen.getByText('Problems near')).toBeInTheDocument();
      expect(screen.getByText('Gurugram')).toBeInTheDocument();
    });

    // A radius means nothing without a point to measure from.
    it('hides the distance filter and the map', async () => {
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText('SAM-1023');

      expect(screen.queryByText(/Within/)).not.toBeInTheDocument();
      expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    });
  });

  // ==================================================================== feed

  describe('rendering the feed', () => {
    it('lists problems with their distance and links to each one', async () => {
      fetchNearbyProblems.mockResolvedValue(
        feed({ origin: { kind: 'coordinates', label: null, radiusMeters: 5000 } }),
      );
      window.localStorage.setItem(
        'samadhaan.discovery.location',
        JSON.stringify({ latitude: 28.4595, longitude: 77.0266, savedAt: Date.now() }),
      );

      render(<NearbyProblems profileCity={null} />);

      expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
      expect(screen.getByText('350 m away')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Large pothole near Sector 12 market' }),
      ).toHaveAttribute('href', '/problems/SAM-1023');
    });

    it('shows skeletons while the first page loads', () => {
      fetchNearbyProblems.mockReturnValue(new Promise(() => {}));

      const { container } = render(<NearbyProblems profileCity="Gurugram" />);

      expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(0);
    });

    it('offers to report when nothing has been reported nearby', async () => {
      fetchNearbyProblems.mockResolvedValue(feed({ items: [] }));

      render(<NearbyProblems profileCity="Gurugram" />);

      expect(
        await screen.findByText(/Good news — no reported problems nearby/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Be the first to report an issue/i }),
      ).toHaveAttribute('href', '/report');
    });

    it('recovers from a failed load', async () => {
      const user = userEvent.setup();
      fetchNearbyProblems.mockRejectedValueOnce(new Error('network down'));

      render(<NearbyProblems profileCity="Gurugram" />);

      expect(await screen.findByText(/Couldn't load nearby problems/)).toBeInTheDocument();

      fetchNearbyProblems.mockResolvedValue(feed());
      await user.click(screen.getByRole('button', { name: /Try again/i }));

      expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
    });

    // A stack trace on a civic dashboard helps nobody and tells an attacker
    // about the internals.
    it('never shows a raw error', async () => {
      fetchNearbyProblems.mockRejectedValue(
        new Error('PrismaClientKnownRequestError: at ProblemDiscoveryService.discover'),
      );

      const { container } = render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText(/Couldn't load nearby problems/);

      expect(container.textContent).not.toMatch(/Prisma|at ProblemDiscoveryService/);
    });
  });

  // ================================================================= filters

  describe('filters', () => {
    it('narrows the query by category', async () => {
      const user = userEvent.setup();
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText('SAM-1023');

      await user.click(screen.getByRole('combobox', { name: /Category/i }));
      await user.click(await screen.findByRole('option', { name: 'Waste collection' }));

      await waitFor(() =>
        expect(fetchNearbyProblems).toHaveBeenLastCalledWith(
          expect.objectContaining({ category: 'GARBAGE' }),
        ),
      );
    });

    it('narrows the query by status', async () => {
      const user = userEvent.setup();
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText('SAM-1023');

      await user.click(screen.getByRole('combobox', { name: /Status/i }));
      await user.click(await screen.findByRole('option', { name: 'Resolved' }));

      await waitFor(() =>
        expect(fetchNearbyProblems).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'RESOLVED' }),
        ),
      );
    });

    it('distinguishes "nothing nearby" from "nothing matches your filters"', async () => {
      const user = userEvent.setup();
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText('SAM-1023');

      fetchNearbyProblems.mockResolvedValue(feed({ items: [] }));
      await user.click(screen.getByRole('combobox', { name: /Category/i }));
      await user.click(await screen.findByRole('option', { name: 'Waste collection' }));

      expect(
        await screen.findByText('No problems match these filters'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Good news — no reported problems nearby/),
      ).not.toBeInTheDocument();
    });

    it('clears the filters back to the full feed', async () => {
      const user = userEvent.setup();
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText('SAM-1023');

      fetchNearbyProblems.mockResolvedValue(feed({ items: [] }));
      await user.click(screen.getByRole('combobox', { name: /Category/i }));
      await user.click(await screen.findByRole('option', { name: 'Waste collection' }));
      await screen.findByText('No problems match these filters');

      fetchNearbyProblems.mockResolvedValue(feed());
      await user.click(screen.getByRole('button', { name: /Clear filters/i }));

      expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
    });

    it('labels the filter group for assistive technology', async () => {
      fetchNearbyProblems.mockResolvedValue(feed());

      render(<NearbyProblems profileCity="Gurugram" />);
      await screen.findByText('SAM-1023');

      expect(screen.getByRole('group', { name: 'Filter problems' })).toBeInTheDocument();
    });
  });

  // ================================================================= privacy

  it('renders nothing identifying a reporter', async () => {
    fetchNearbyProblems.mockResolvedValue(feed());

    const { container } = render(<NearbyProblems profileCity="Gurugram" />);
    await screen.findByText('SAM-1023');

    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/Reported by/i);
  });
});
