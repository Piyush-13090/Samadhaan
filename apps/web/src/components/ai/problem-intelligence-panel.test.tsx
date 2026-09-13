import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProblemAnalysisView } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { ProblemIntelligencePanel } from './problem-intelligence-panel';

const { fetchAnalysis, retryAnalysis } = vi.hoisted(() => ({
  fetchAnalysis: vi.fn(),
  retryAnalysis: vi.fn(),
}));

vi.mock('@/services/problems.service', () => ({ fetchAnalysis, retryAnalysis }));

function analysis(overrides: Partial<ProblemAnalysisView> = {}): ProblemAnalysisView {
  return {
    id: 'ana-1',
    status: 'COMPLETED',
    category: 'POTHOLES',
    subcategory: 'road surface cavity',
    severity: 'HIGH',
    urgency: 'HIGH',
    severityScore: 7.5,
    summary: 'A deep pothole near a junction is a hazard to two-wheelers.',
    confidence: 0.91,
    observations: ['A cavity is visible in the road surface.'],
    modelName: 'claude-opus-5',
    textOnly: false,
    errorMessage: null,
    processingMs: 3100,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:05.000Z',
    ...overrides,
  };
}

describe('ProblemIntelligencePanel', () => {
  beforeEach(() => {
    fetchAnalysis.mockReset();
    retryAnalysis.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading skeleton until the first result arrives', () => {
    fetchAnalysis.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry={false} />,
    );

    expect(container.querySelector('[data-slot="skeleton"], .animate-shimmer')).not.toBeNull();
  });

  /**
   * A completed analysis resolved on the server must paint immediately — the
   * whole point of seeding the panel is to avoid a flash of loading on a page
   * where the answer is already known.
   */
  it('renders a seeded completed analysis without fetching', () => {
    render(
      <ProblemIntelligencePanel publicId="SAM-1" initial={analysis()} canRetry={false} />,
    );

    expect(screen.getByText('Potholes')).toBeInTheDocument();
    expect(fetchAnalysis).not.toHaveBeenCalled();
  });

  it('renders the processing state while an analysis is in flight', async () => {
    fetchAnalysis.mockResolvedValue(analysis({ status: 'PROCESSING' }));

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry />);

    expect(
      await screen.findByText('Samadhaan AI is analysing your report'),
    ).toBeInTheDocument();
  });

  it('renders the completed card once polling resolves', async () => {
    fetchAnalysis.mockResolvedValue(analysis());

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry={false} />);

    expect(await screen.findByText('Potholes')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
  });

  it('renders the failed state with the reason', async () => {
    fetchAnalysis.mockResolvedValue(
      analysis({
        status: 'FAILED',
        errorMessage: 'The analysis service could not be reached.',
        category: null,
        confidence: null,
      }),
    );

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry />);

    expect(
      await screen.findByText(/AI analysis couldn’t be completed right now/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The analysis service could not be reached/),
    ).toBeInTheDocument();
  });

  /**
   * A tab left open on a finished analysis must not keep asking. This is the
   * assertion that keeps a polling client from becoming a load generator.
   */
  it('stops polling once the analysis is COMPLETED', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchAnalysis.mockResolvedValue(analysis());

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry={false} />);

    await waitFor(() => expect(screen.getByText('Potholes')).toBeInTheDocument());
    const callsAtCompletion = fetchAnalysis.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchAnalysis).toHaveBeenCalledTimes(callsAtCompletion);
  });

  it('stops polling once the analysis has FAILED', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchAnalysis.mockResolvedValue(analysis({ status: 'FAILED', errorMessage: null }));

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry />);

    await waitFor(() =>
      expect(screen.getByText(/couldn’t be completed/)).toBeInTheDocument(),
    );
    const callsAtFailure = fetchAnalysis.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchAnalysis).toHaveBeenCalledTimes(callsAtFailure);
  });

  it('keeps polling while the analysis is still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchAnalysis.mockResolvedValue(analysis({ status: 'PROCESSING' }));

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry={false} />);

    await waitFor(() => expect(fetchAnalysis).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(6_000);

    expect(fetchAnalysis.mock.calls.length).toBeGreaterThan(1);
  });

  it('requests a new analysis when retry is used', async () => {
    const user = userEvent.setup();
    fetchAnalysis.mockResolvedValue(analysis({ status: 'FAILED', errorMessage: null }));
    retryAnalysis.mockResolvedValue(analysis({ status: 'PENDING', category: null }));

    render(<ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry />);

    await user.click(await screen.findByRole('button', { name: /Try analysis again/i }));

    expect(retryAnalysis).toHaveBeenCalledWith('SAM-1');
    // The panel returns to the processing state, so the citizen sees the work.
    expect(
      await screen.findByText('Samadhaan AI is analysing your report'),
    ).toBeInTheDocument();
  });

  it('renders nothing when a problem has never been analysed', async () => {
    fetchAnalysis.mockResolvedValue(null);

    const { container } = render(
      <ProblemIntelligencePanel publicId="SAM-1" initial={null} canRetry={false} />,
    );

    await waitFor(() => expect(fetchAnalysis).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
