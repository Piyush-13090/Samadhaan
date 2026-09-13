import type { ProfileActivity } from '@samadhaan/shared';
import { describe, expect, it } from 'vitest';
import { renderWithProviders as render, screen } from '@/test/render';
import { ActivitySummary } from './activity-summary';

const BASE: ProfileActivity = {
  problemsReported: 8,
  problemsSupported: 24,
  commentsPosted: 3,
  suggestionsMade: 2,
  problemsResolved: 5,
  impactPoints: null,
};

describe('ActivitySummary', () => {
  it('renders the real counts', () => {
    render(<ActivitySummary activity={BASE} />);

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  /**
   * The point of the whole null-vs-zero distinction: an unbuilt feature must
   * not render as a measured score of nothing.
   */
  it('shows an unavailable metric as a dash, never as zero', () => {
    render(<ActivitySummary activity={BASE} />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Not yet available')).toBeInTheDocument();
  });

  it('renders a genuine zero as zero', () => {
    render(<ActivitySummary activity={{ ...BASE, problemsReported: 0 }} />);

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('exposes the metrics as a labelled list', () => {
    render(<ActivitySummary activity={BASE} />);

    expect(screen.getByRole('list', { name: 'Civic activity' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});
