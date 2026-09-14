import { describe, expect, it } from 'vitest';
import type { ProblemListItem } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { ProblemListCard } from './problem-list-card';

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

describe('ProblemListCard', () => {
  it('shows the reference, title, status, severity and locality', () => {
    render(<ProblemListCard problem={item()} />);

    expect(screen.getByText('SAM-1023')).toBeInTheDocument();
    expect(screen.getByText('Under review')).toBeInTheDocument();
    expect(screen.getByText('Main Market Crossing')).toBeInTheDocument();
    expect(screen.getByText('350 m away')).toBeInTheDocument();
  });

  /**
   * The accessible name must be the title alone. Wrapping the badges and
   * counts in the anchor instead would make the announced link unreadable.
   */
  it('links the whole card by its title', () => {
    render(<ProblemListCard problem={item()} />);

    expect(
      screen.getByRole('link', { name: 'Large pothole near Sector 12 market' }),
    ).toHaveAttribute('href', '/problems/SAM-1023');
  });

  it('hides distance where it is meaningless', () => {
    render(<ProblemListCard problem={item()} showDistance={false} />);

    expect(screen.queryByText('350 m away')).not.toBeInTheDocument();
  });

  it('omits distance when the search had no origin', () => {
    render(<ProblemListCard problem={item({ distanceMeters: null })} />);

    expect(screen.queryByText(/away/)).not.toBeInTheDocument();
  });

  it('marks a problem the AI has analysed', () => {
    render(<ProblemListCard problem={item()} />);
    expect(screen.getByText('Analysed by Samadhaan AI')).toBeInTheDocument();
  });

  it('does not mark one it has not', () => {
    render(<ProblemListCard problem={item({ hasAiAnalysis: false })} />);
    expect(screen.queryByText('Analysed by Samadhaan AI')).not.toBeInTheDocument();
  });

  /**
   * Status, severity and category must not rest on colour. Each is a badge
   * with a text label, so every one survives greyscale and a screen reader.
   */
  it('labels status, severity and counts in text', () => {
    const { container } = render(<ProblemListCard problem={item()} />);

    expect(screen.getByText('Under review')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(container.textContent).toContain('214');
    expect(screen.getByText('people also affected')).toBeInTheDocument();
  });

  // A feed card takes the API's list shape, which has no reporter to leak.
  it('shows nothing identifying the reporter', () => {
    const { container } = render(<ProblemListCard problem={item()} />);

    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/Reported by/i);
  });

  // The card sits in a one-column grid at phone width.
  it('sets no fixed or minimum width that would break a phone layout', () => {
    const { container } = render(<ProblemListCard problem={item()} />);

    for (const element of container.querySelectorAll('*')) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/\bw-\[\d{3,}px\]/);
      expect(classes).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
    }
  });

  it('renders a thumbnail when one exists, decoratively', () => {
    const { container } = render(
      <ProblemListCard problem={item({ thumbnailUrl: 'http://example.test/a.jpg' })} />,
    );

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'http://example.test/a.jpg');
    // The title carries the meaning; describing someone else's photo does not.
    expect(image).toHaveAttribute('alt', '');
  });
});
