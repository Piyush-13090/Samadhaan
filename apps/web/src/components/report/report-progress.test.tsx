import { describe, expect, it } from 'vitest';
import { renderWithProviders as render, screen } from '@/test/render';
import { ReportProgress, REPORT_STEPS } from './report-progress';

describe('ReportProgress', () => {
  it('renders every step', () => {
    render(<ReportProgress current={0} />);

    for (const label of REPORT_STEPS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  // A purely visual progress bar tells a screen-reader user nothing.
  it('marks the active step with aria-current', () => {
    render(<ReportProgress current={1} />);

    const current = screen.getByText('Location').closest('[aria-current]');
    expect(current).toHaveAttribute('aria-current', 'step');
  });

  it('announces position and total', () => {
    render(<ReportProgress current={2} />);

    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
  });

  it('is a labelled navigation landmark', () => {
    render(<ReportProgress current={0} />);

    expect(
      screen.getByRole('navigation', { name: 'Report progress' }),
    ).toBeInTheDocument();
  });
});
