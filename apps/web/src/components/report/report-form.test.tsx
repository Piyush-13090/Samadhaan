import userEvent from '@testing-library/user-event';
import type { ProblemView } from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render, screen, waitFor } from '@/test/render';
import * as problemsService from '@/services/problems.service';
import { ReportForm } from './report-form';

vi.mock('@/services/problems.service');

const CREATED: ProblemView = {
  id: 'prb-1',
  publicId: 'SAM-1042',
  title: 'Open manhole outside the clinic',
  description: 'An open manhole on the footpath outside the Sector 12 clinic.',
  category: 'PUBLIC_SAFETY',
  subcategory: null,
  status: 'SUBMITTED',
  severity: 'MEDIUM',
  location: {
    latitude: 28.4595,
    longitude: 77.0266,
    address: null,
    city: null,
    state: null,
    country: 'India',
    postalCode: null,
  },
  images: [],
  reporter: { id: 'usr-1', name: 'priya', avatarUrl: null },
  voteCount: 0,
  commentCount: 0,
  createdAt: '2026-09-13T09:00:00.000Z',
  submittedAt: '2026-09-13T09:00:00.000Z',
};

/** Fills step 1 with values that pass client validation. */
async function completeDetails() {
  await userEvent.type(
    screen.getByLabelText(/What is the problem/),
    'Open manhole outside the clinic',
  );
  await userEvent.type(
    screen.getByLabelText(/Describe it/),
    'An open manhole on the footpath outside the Sector 12 clinic. It is unlit after dark.',
  );
  await userEvent.click(screen.getByRole('radio', { name: 'Public safety' }));
}

/**
 * Regex matchers, because `Field` appends a required marker to the label — the
 * accessible name is "Latitude*", which is what a screen reader announces.
 */
async function completeLocation() {
  await userEvent.type(screen.getByLabelText(/^Latitude/), '28.4595');
  await userEvent.type(screen.getByLabelText(/^Longitude/), '77.0266');
}

describe('ReportForm', () => {
  beforeEach(() => {
    vi.mocked(problemsService.createProblem).mockResolvedValue(CREATED);
  });

  it('starts on the problem step', () => {
    render(<ReportForm />);

    expect(screen.getByLabelText(/What is the problem/)).toBeInTheDocument();
    expect(screen.getByText('Problem')).toBeInTheDocument();
  });

  // --- validation ---------------------------------------------------------

  it('blocks progress and shows errors when required fields are empty', async () => {
    render(<ReportForm />);

    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(screen.getByText(/at least 20 characters/)).toBeInTheDocument();
    expect(screen.getByText('Choose a category.')).toBeInTheDocument();

    // Still on step 1.
    expect(screen.getByLabelText(/What is the problem/)).toBeInTheDocument();
  });

  it('requires a location before the review step', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByLabelText(/^Latitude/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(await screen.findAllByText('A location is required.')).not.toHaveLength(0);
  });

  it('rejects an out-of-range coordinate', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await userEvent.type(await screen.findByLabelText(/^Latitude/), '95');
    await userEvent.type(screen.getByLabelText(/^Longitude/), '77');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(await screen.findByText(/between -90 and 90/)).toBeInTheDocument();
  });

  // --- navigation ---------------------------------------------------------

  it('walks through the steps and shows the entered data on review', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await completeLocation();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    expect(
      await screen.findByText('Check your report before submitting.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Open manhole outside the clinic')).toBeInTheDocument();
    expect(screen.getByText(/Sector 12 clinic/)).toBeInTheDocument();
    expect(screen.getByText('Public safety')).toBeInTheDocument();
  });

  // Data must survive moving between steps, which is what makes the flow usable.
  it('preserves entered data when stepping back', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText(/What is the problem/)).toHaveValue(
      'Open manhole outside the clinic',
    );
    expect(screen.getByRole('radio', { name: 'Public safety' })).toBeChecked();
  });

  it('returns to the right step from a review Edit control', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await completeLocation();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    await userEvent.click(editButtons[editButtons.length - 1]!);

    expect(await screen.findByLabelText(/^Latitude/)).toHaveValue(28.4595);
  });

  // --- submission ---------------------------------------------------------

  it('submits and shows the public problem id', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await completeLocation();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Submit report/ }));

    expect(await screen.findByText('SAM-1042')).toBeInTheDocument();
    expect(screen.getByText('Your problem has been reported.')).toBeInTheDocument();
  });

  it('sends the entered values to the API', async () => {
    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await completeLocation();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Submit report/ }));

    await waitFor(() => {
      expect(problemsService.createProblem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Open manhole outside the clinic',
          category: 'PUBLIC_SAFETY',
          location: expect.objectContaining({ latitude: 28.4595, longitude: 77.0266 }),
        }),
      );
    });
  });

  /**
   * Two identical reports is the worst failure mode here — the queue would
   * carry a phantom problem that a reviewer has to notice and merge.
   */
  it('does not submit twice when the button is clicked repeatedly', async () => {
    let resolve: ((value: ProblemView) => void) | undefined;
    vi.mocked(problemsService.createProblem).mockReturnValue(
      new Promise<ProblemView>((r) => {
        resolve = r;
      }),
    );

    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await completeLocation();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    const submit = await screen.findByRole('button', { name: /Submit report/ });
    await userEvent.click(submit);

    // Disabled while in flight, so further clicks cannot reach the handler.
    await waitFor(() => expect(submit).toBeDisabled());
    await userEvent.click(submit).catch(() => undefined);

    expect(problemsService.createProblem).toHaveBeenCalledTimes(1);

    resolve?.(CREATED);
  });

  it('shows a readable message when the API rejects the report', async () => {
    vi.mocked(problemsService.createProblem).mockRejectedValue(new Error('network down'));

    render(<ReportForm />);

    await completeDetails();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await completeLocation();
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Submit report/ }));

    expect(await screen.findByText('Could not submit your report')).toBeInTheDocument();
    // The form is still there, so nothing the citizen typed is lost.
    expect(screen.getByRole('button', { name: /Submit report/ })).toBeEnabled();
  });
});
