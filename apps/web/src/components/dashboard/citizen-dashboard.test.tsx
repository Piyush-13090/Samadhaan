import { describe, expect, it, vi } from 'vitest';
import type { CitizenDashboard as CitizenDashboardData } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { CitizenDashboard } from './citizen-dashboard';

// The nearby section fetches on mount and owns its own tests.
vi.mock('@/components/discovery/nearby-problems', () => ({
  NearbyProblems: () => <div data-testid="nearby-problems" />,
}));

function report(overrides: Record<string, unknown> = {}) {
  return {
    publicId: 'SAM-1023',
    title: 'Large pothole near Sector 12 market',
    category: 'POTHOLES' as const,
    subcategory: 'Road surface failure',
    status: 'UNDER_REVIEW' as const,
    severity: 'HIGH' as const,
    urgency: 'HIGH' as const,
    area: 'Main Market Crossing',
    city: 'Gurugram',
    distanceMeters: null,
    voteCount: 214,
    commentCount: 3,
    thumbnailUrl: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    hasAiAnalysis: true,
    isOwnReport: true,
    ...overrides,
  };
}

function dashboard(overrides: Partial<CitizenDashboardData> = {}): CitizenDashboardData {
  return {
    user: { name: 'Priya Sharma', firstName: 'Priya', city: 'Gurugram', state: 'Haryana' },
    activity: {
      problemsReported: 7,
      problemsSupported: 2,
      commentsPosted: 0,
      suggestionsMade: 0,
      problemsResolved: 1,
      impactPoints: null,
    },
    recentReports: [report()],
    reportCount: 7,
    ...overrides,
  };
}

describe('CitizenDashboard', () => {
  it('greets the signed-in user by name', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Good morning, Priya.',
    );
    expect(
      screen.getByText(/Here’s what’s happening around your community/),
    ).toBeInTheDocument();
  });

  it('varies the greeting with the time of day', () => {
    const { unmount } = render(<CitizenDashboard data={dashboard()} hour={14} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon');
    unmount();

    render(<CitizenDashboard data={dashboard()} hour={20} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening');
  });

  it('makes Report a problem the primary action and links it to the report flow', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    const cta = screen.getAllByRole('link', { name: /Report a problem/i })[0]!;
    expect(cta).toHaveAttribute('href', '/report');
  });

  it('renders counts from the API', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    expect(screen.getByText('Problems reported')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Problems supported')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  /**
   * A zero here would read as a measured score of nothing. The ledger does not
   * exist, so the metric says so rather than inventing a number.
   */
  it('shows impact points as pending rather than zero', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    expect(screen.getByText('Impact points')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows a real value once the ledger exists', () => {
    render(
      <CitizenDashboard
        data={dashboard({
          activity: { ...dashboard().activity, impactPoints: 320 },
        })}
        hour={9}
      />,
    );

    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('lists the user’s recent reports', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    expect(screen.getByText('SAM-1023')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Large pothole near Sector 12 market' }),
    ).toHaveAttribute('href', '/problems/SAM-1023');
    expect(screen.getByText('Under review')).toBeInTheDocument();
  });

  it('offers view-all only when there is more than the page shows', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);
    expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute(
      'href',
      '/my-problems',
    );
  });

  it('hides view-all when every report is already listed', () => {
    render(
      <CitizenDashboard data={dashboard({ reportCount: 1 })} hour={9} />,
    );

    expect(screen.queryByRole('link', { name: /View all/i })).not.toBeInTheDocument();
  });

  it('prompts a new citizen who has reported nothing', () => {
    render(
      <CitizenDashboard
        data={dashboard({ recentReports: [], reportCount: 0 })}
        hour={9}
      />,
    );

    expect(
      screen.getByText(/You haven't reported any problems yet/),
    ).toBeInTheDocument();
  });

  it('renders the nearby section', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    expect(screen.getByTestId('nearby-problems')).toBeInTheDocument();
  });

  // Every section is a labelled landmark, so the page is navigable by heading.
  it('gives each section an accessible heading', () => {
    render(<CitizenDashboard data={dashboard()} hour={9} />);

    for (const name of ['Your impact', 'Nearby problems', 'Your reports']) {
      expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
  });

  /**
   * A feed card must not be able to display a reporter, because the API does
   * not send one. This guards the component against a future prop being wired
   * back in.
   */
  it('shows nothing identifying the reporter', () => {
    const { container } = render(<CitizenDashboard data={dashboard()} hour={9} />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/Reported by/i);
  });
});
