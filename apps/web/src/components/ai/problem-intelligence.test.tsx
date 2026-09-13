import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { ProblemAnalysisView } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { AnalysisProcessing } from './analysis-processing';
import { AnalysisFailed, ProblemIntelligence } from './problem-intelligence';

const COMPLETED: ProblemAnalysisView = {
  id: 'ana-1',
  status: 'COMPLETED',
  category: 'POTHOLES',
  subcategory: 'road surface cavity',
  severity: 'HIGH',
  urgency: 'HIGH',
  severityScore: 7.5,
  summary: 'A deep pothole near a junction is a hazard to two-wheelers.',
  confidence: 0.91,
  observations: ['A cavity is visible in the road surface.', 'Traffic is diverting.'],
  modelName: 'claude-opus-5',
  textOnly: false,
  errorMessage: null,
  processingMs: 3100,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:05.000Z',
};

describe('ProblemIntelligence', () => {
  it('renders the analysis findings', () => {
    render(<ProblemIntelligence analysis={COMPLETED} />);

    expect(screen.getByText('Potholes')).toBeInTheDocument();
    expect(screen.getByText('road surface cavity')).toBeInTheDocument();
    expect(screen.getByText('7.5 / 10')).toBeInTheDocument();
    expect(screen.getByText(COMPLETED.summary!)).toBeInTheDocument();

    for (const observation of COMPLETED.observations) {
      expect(screen.getByText(observation)).toBeInTheDocument();
    }
  });

  // Confidence is a claim about certainty; a bare bar tells a screen-reader
  // user nothing, and the band keeps the number from reading as a measurement.
  it('exposes confidence as an accessible meter', () => {
    render(<ProblemIntelligence analysis={COMPLETED} />);

    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '91');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('91%')).toBeInTheDocument();
  });

  it('states that a reviewer confirms the analysis', () => {
    render(<ProblemIntelligence analysis={COMPLETED} />);

    expect(screen.getByText(/A reviewer confirms it/i)).toBeInTheDocument();
  });

  it('says when the analysis came from the description alone', () => {
    render(<ProblemIntelligence analysis={{ ...COMPLETED, textOnly: true }} />);

    expect(screen.getByText('From description only')).toBeInTheDocument();
  });

  /**
   * The single most damaging thing this page could do is present a keyword stub
   * as an AI finding. It must say so, visibly.
   */
  it('warns when the result came from the development placeholder', () => {
    render(
      <ProblemIntelligence
        analysis={{ ...COMPLETED, modelName: 'development-keyword-stub' }}
      />,
    );

    expect(screen.getByText(/development placeholder, not an AI model/i)).toBeInTheDocument();
  });

  it('does not warn for a real model', () => {
    render(<ProblemIntelligence analysis={COMPLETED} />);

    expect(screen.queryByText(/development placeholder/i)).not.toBeInTheDocument();
  });

  it('renders a partial analysis without crashing', () => {
    render(
      <ProblemIntelligence
        analysis={{
          ...COMPLETED,
          category: null,
          subcategory: null,
          severity: null,
          severityScore: null,
          urgency: null,
          summary: null,
          confidence: null,
          observations: [],
        }}
      />,
    );

    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('AnalysisProcessing', () => {
  it('renders every stage', () => {
    render(<AnalysisProcessing elapsedMs={0} />);

    expect(screen.getByText('Understanding the photo')).toBeInTheDocument();
    expect(screen.getByText('Preparing a summary')).toBeInTheDocument();
  });

  it('announces that work is in progress', () => {
    const { container } = render(<AnalysisProcessing elapsedMs={0} />);

    const region = container.querySelector('[aria-busy="true"]');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  // The stages are indicative, not measured — but they must still hold at the
  // last one rather than showing a finished checklist while work continues.
  it('holds at the final stage rather than completing early', () => {
    const { container } = render(<AnalysisProcessing elapsedMs={120_000} />);

    const items = container.querySelectorAll('ol li');
    expect(items).toHaveLength(5);
    expect(screen.getByText('Preparing a summary')).toHaveClass('font-medium');
  });
});

describe('AnalysisFailed', () => {
  it('shows the reason and reassures that the report survived', () => {
    render(<AnalysisFailed message="The analysis service could not be reached." />);

    expect(
      screen.getByText(/The analysis service could not be reached/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your report has been\s+saved and is unaffected/)).toBeInTheDocument();
  });

  it('falls back to a generic reason when none was given', () => {
    render(<AnalysisFailed message={null} />);

    expect(screen.getByText(/The analysis service was unavailable/)).toBeInTheDocument();
  });

  it('offers retry to someone allowed to use it', async () => {
    const onRetry = vi.fn();
    render(<AnalysisFailed message={null} onRetry={onRetry} canRetry />);

    await userEvent.click(screen.getByRole('button', { name: /Try analysis again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  // Mirrors the API rule; a button that always 403s is worse than no button.
  it('hides retry from someone who may not trigger it', () => {
    render(<AnalysisFailed message={null} onRetry={vi.fn()} canRetry={false} />);

    expect(screen.queryByRole('button', { name: /Try analysis again/i })).not.toBeInTheDocument();
  });
});
