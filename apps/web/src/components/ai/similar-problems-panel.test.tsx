import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DuplicateCheckView, SimilarProblemView } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { SimilarProblemsPanel } from './similar-problems-panel';

const { fetchSimilar, confirmDuplicate, rejectDuplicate } = vi.hoisted(() => ({
  fetchSimilar: vi.fn(),
  confirmDuplicate: vi.fn(),
  rejectDuplicate: vi.fn(),
}));

vi.mock('@/services/problems.service', () => ({
  fetchSimilar,
  confirmDuplicate,
  rejectDuplicate,
}));

function candidate(overrides: Partial<SimilarProblemView> = {}): SimilarProblemView {
  return {
    candidateId: 'pair-1',
    problem: {
      publicId: 'SAM-1023',
      title: 'Large pothole near Sector 12 market',
      category: 'POTHOLES',
      subcategory: 'Road surface failure',
      status: 'UNDER_REVIEW',
      city: 'Gurugram',
      createdAt: '2026-09-10T00:00:00.000Z',
      voteCount: 214,
      thumbnailUrl: null,
    },
    similarity: 0.91,
    confidence: 0.78,
    distanceMeters: 350,
    verdict: 'LIKELY_DUPLICATE',
    status: 'LIKELY_DUPLICATE',
    signals: {
      text: 0.91,
      image: null,
      geographic: 0.97,
      category: 1,
      temporal: 0.88,
    },
    evidence: [
      { id: 'text-strong', label: 'Describes a very similar problem' },
      { id: 'category', label: 'Same civic category' },
      { id: 'geo', label: 'Reported nearby' },
    ],
    ...overrides,
  };
}

function check(overrides: Partial<DuplicateCheckView> = {}): DuplicateCheckView {
  return {
    status: 'COMPLETED',
    candidates: [candidate()],
    comparedCount: 12,
    errorMessage: null,
    checkedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('SimilarProblemsPanel', () => {
  beforeEach(() => {
    fetchSimilar.mockReset();
    confirmDuplicate.mockReset();
    rejectDuplicate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading skeleton until the first result arrives', () => {
    fetchSimilar.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <SimilarProblemsPanel publicId="SAM-1" initial={null} canReview={false} />,
    );

    expect(
      container.querySelector('[data-slot="skeleton"], .animate-shimmer'),
    ).not.toBeNull();
  });

  it('shows a checking state while the check is still running', async () => {
    fetchSimilar.mockResolvedValue(check({ status: 'PROCESSING', candidates: [] }));

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    expect(
      await screen.findByText(/Checking whether this has already been reported/),
    ).toBeInTheDocument();
  });

  it('renders a seeded completed check without fetching', () => {
    render(<SimilarProblemsPanel publicId="SAM-1" initial={check()} canReview={false} />);

    expect(screen.getByText('SAM-1023')).toBeInTheDocument();
    expect(fetchSimilar).not.toHaveBeenCalled();
  });

  it('renders the candidate with its score, distance and status', async () => {
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
    expect(screen.getByText('Large pothole near Sector 12 market')).toBeInTheDocument();
    expect(screen.getByText('91% similar')).toBeInTheDocument();
    expect(screen.getByText('350 m away')).toBeInTheDocument();
    expect(screen.getByText('Under review')).toBeInTheDocument();
    expect(screen.getByText('Potholes')).toBeInTheDocument();
  });

  it('lists the evidence behind the match', async () => {
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    expect(await screen.findByText('Describes a very similar problem')).toBeInTheDocument();
    expect(screen.getByText('Same civic category')).toBeInTheDocument();
    expect(screen.getByText('Reported nearby')).toBeInTheDocument();
  });

  /**
   * The wording commitment. AI similarity is probabilistic, so the UI states a
   * claim with a strength and never a verdict — and never narrates a model.
   */
  it('never asserts a duplicate or narrates the model', async () => {
    fetchSimilar.mockResolvedValue(check());

    const { container } = render(
      <SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />,
    );
    await screen.findByText('SAM-1023');

    const text = container.textContent ?? '';
    expect(screen.getByText('Likely the same problem')).toBeInTheDocument();
    expect(text).not.toMatch(/this is a duplicate/i);
    expect(text).not.toMatch(/definitely/i);
    expect(text).not.toMatch(/AI thinks/i);
    expect(text).not.toMatch(/\b(vector|embedding|cosine)\b/i);
  });

  it('says that nothing is merged automatically', async () => {
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    expect(
      await screen.findByText(/Nothing is merged automatically/),
    ).toBeInTheDocument();
  });

  it('words a possible match more softly than a likely one', async () => {
    fetchSimilar.mockResolvedValue(
      check({ candidates: [candidate({ verdict: 'POSSIBLE_DUPLICATE' })] }),
    );

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    expect(await screen.findByText('Possibly the same problem')).toBeInTheDocument();
  });

  it('links to the existing problem', async () => {
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    const link = await screen.findByRole('link', { name: /View problem/i });
    expect(link).toHaveAttribute('href', '/problems/SAM-1023');
  });

  // Silence is the useful answer on the vast majority of reports.
  it('renders nothing when the check found no candidates', async () => {
    fetchSimilar.mockResolvedValue(check({ candidates: [] }));

    const { container } = render(
      <SimilarProblemsPanel publicId="SAM-1" initial={null} canReview={false} />,
    );

    await waitFor(() => expect(fetchSimilar).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('explains a failed check and reassures that the report survived', async () => {
    fetchSimilar.mockResolvedValue(
      check({
        status: 'FAILED',
        candidates: [],
        errorMessage: 'The analysis service could not be reached.',
      }),
    );

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    expect(
      await screen.findByText(/Similar problems couldn’t be checked/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your report has been saved and is unaffected/)).toBeInTheDocument();
  });

  /**
   * A single failed poll is usually a network blip. The panel must keep trying
   * within its cap rather than declaring the check dead — and must never take
   * the page down with it.
   */
  it('retries a failed poll instead of erroring out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSimilar.mockRejectedValueOnce(new Error('network blip'));
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    await waitFor(() => expect(fetchSimilar).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
  });

  // =============================================================== actions

  it('records that the two reports are the same issue', async () => {
    const user = userEvent.setup();
    fetchSimilar.mockResolvedValue(check());
    confirmDuplicate.mockResolvedValue(check({ candidates: [] }));

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    await user.click(await screen.findByRole('button', { name: /Same issue/i }));

    expect(confirmDuplicate).toHaveBeenCalledWith('SAM-1', 'pair-1');
    // The server's updated check drives the UI, not a client-side guess.
    await waitFor(() => expect(screen.queryByText('SAM-1023')).not.toBeInTheDocument());
  });

  it('records that the two reports are different', async () => {
    const user = userEvent.setup();
    fetchSimilar.mockResolvedValue(check());
    rejectDuplicate.mockResolvedValue(check({ candidates: [] }));

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    await user.click(await screen.findByRole('button', { name: /Different issue/i }));

    expect(rejectDuplicate).toHaveBeenCalledWith('SAM-1', 'pair-1');
  });

  it('reports a failed action without discarding the candidate', async () => {
    const user = userEvent.setup();
    fetchSimilar.mockResolvedValue(check());
    rejectDuplicate.mockRejectedValue(new Error('nope'));

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />);

    await user.click(await screen.findByRole('button', { name: /Different issue/i }));

    expect(await screen.findByText(/Could not record your answer/)).toBeInTheDocument();
  });

  // Mirrors the API rule; a button that always 403s is worse than no button.
  it('hides the actions from someone who may not review', async () => {
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview={false} />);

    await screen.findByText('SAM-1023');

    expect(screen.queryByRole('button', { name: /Same issue/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Different issue/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Only the person who filed this report can confirm a match/),
    ).toBeInTheDocument();
  });

  // =============================================================== polling

  it('stops polling once the check is COMPLETED', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSimilar.mockResolvedValue(check());

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview={false} />);

    await waitFor(() => expect(screen.getByText('SAM-1023')).toBeInTheDocument());
    const callsAtCompletion = fetchSimilar.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchSimilar).toHaveBeenCalledTimes(callsAtCompletion);
  });

  it('keeps polling while the check is still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSimilar.mockResolvedValue(check({ status: 'PROCESSING', candidates: [] }));

    render(<SimilarProblemsPanel publicId="SAM-1" initial={null} canReview={false} />);

    await waitFor(() => expect(fetchSimilar).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6_000);

    expect(fetchSimilar.mock.calls.length).toBeGreaterThan(1);
  });

  // ============================================================ responsive

  /**
   * The panel sits in a narrow column on the problem page and full-bleed on a
   * phone, so nothing inside it may set a fixed width or a min-width that would
   * force the page to scroll sideways at ~360px.
   */
  it('uses no fixed or minimum widths that would break a phone layout', async () => {
    fetchSimilar.mockResolvedValue(check());

    const { container } = render(
      <SimilarProblemsPanel publicId="SAM-1" initial={null} canReview />,
    );
    await screen.findByText('SAM-1023');

    for (const element of container.querySelectorAll('*')) {
      // `className` is an SVGAnimatedString on SVG nodes, not a string.
      const classes = element.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/\bw-\[\d{3,}px\]/);
      expect(classes).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
    }

    // The action row wraps rather than overflowing.
    const actions = container.querySelector('.flex.flex-wrap.items-center.gap-2');
    expect(actions).not.toBeNull();
  });
});
