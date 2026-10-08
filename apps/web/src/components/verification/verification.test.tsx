import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type {
  EvidenceView,
  GovernmentVerificationView,
  ProjectVerificationView,
  VerificationAssessmentView,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemAssignmentCard } from '@/components/allocation/problem-assignment-card';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { AiVerificationReview } from './ai-verification-review';
import { EvidenceCard } from './evidence-card';
import { EvidenceUploadDialog, checkFile } from './evidence-upload-dialog';
import { GovernmentVerificationPanel } from './government-verification-panel';
import { ProblemResolutionCard } from './problem-resolution-card';
import { ProjectEvidencePanel } from './project-evidence-panel';

const service = vi.hoisted(() => ({
  fetchProjectVerification: vi.fn(),
  createEvidence: vi.fn(),
  uploadEvidenceFile: vi.fn(),
  submitEvidence: vi.fn(),
  removeEvidenceFile: vi.fn(),
  withdrawEvidence: vi.fn(),
  analyzeEvidence: vi.fn(),
  requestVerification: vi.fn(),
  fetchGovernmentVerification: vi.fn(),
  approveResolution: vi.fn(),
  rejectResolution: vi.fn(),
  requestMoreEvidence: vi.fn(),
}));
vi.mock('@/services/verification.service', () => service);

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

function assessment(
  overrides: Partial<VerificationAssessmentView> = {},
): VerificationAssessmentView {
  return {
    id: 'a1',
    status: 'COMPLETED',
    recommendation: 'LIKELY_RESOLVED',
    aiRecommendation: 'LIKELY_RESOLVED',
    confidence: 0.86,
    evidenceQuality: 84,
    signals: [
      {
        key: 'relevance',
        label: 'Relevance to the reported issue',
        value: 0.92,
        confidence: 0.9,
        source: 'AI review',
      },
      {
        key: 'locationConsistency',
        label: 'Location consistency',
        value: null,
        confidence: 0,
        source: 'No photo carries GPS metadata',
      },
    ],
    supporting: [{ text: 'After image shows repaired road surface', refs: ['F1', 'B1'] }],
    remainingIssues: [{ text: 'Durability cannot be judged', refs: ['F1'] }],
    adjustments: [],
    concerns: [],
    missingEvidence: [
      {
        kind: 'AFTER_IMAGE',
        label: 'After photo',
        required: true,
        satisfied: true,
        satisfiedBy: 'An after photo was submitted',
      },
      {
        kind: 'DOCUMENT',
        label: 'Completion document',
        required: false,
        satisfied: false,
        satisfiedBy: null,
      },
    ],
    guidance: [],
    model: {
      name: 'claude-x',
      version: '1',
      promptVersion: 'evidence-verification-2026-10-v1',
      verificationVersion: 'verification-baseline-v1',
    },
    failureMessage: null,
    createdAt: '2026-10-07T08:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceView> = {}): EvidenceView {
  return {
    id: 'e1',
    evidenceType: 'AFTER_IMAGE',
    title: 'Road repair completed',
    description: 'Patched with hot mix.',
    status: 'AI_REVIEWED',
    version: 1,
    replacesEvidenceId: null,
    replacedByEvidenceId: null,
    submittedBy: { name: 'Rahul' },
    submittedAt: '2026-10-07T08:00:00.000Z',
    createdAt: '2026-10-07T07:50:00.000Z',
    decisionReason: null,
    aiStatus: 'COMPLETED',
    files: [
      {
        id: 'f1',
        role: 'AFTER',
        fileName: 'after.jpg',
        mimeType: 'image/jpeg',
        fileSize: 240000,
        checksum: 'a'.repeat(64),
        url: '/api/v1/evidence/e1/files/f1',
        width: 1200,
        height: 900,
        capturedAt: null,
        locationDistanceM: 18,
        createdAt: '2026-10-07T07:55:00.000Z',
      },
    ],
    assessment: assessment(),
    permissions: {
      canUpload: false,
      canSubmit: false,
      canWithdraw: true,
      canAnalyze: false,
    },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('AiVerificationReview', () => {
  it('presents the review as advisory, never as a decision', async () => {
    render(<AiVerificationReview assessment={assessment()} />);
    expect(screen.getByText('Advisory')).toBeInTheDocument();
    expect(screen.getByText('Likely resolved')).toBeInTheDocument();
    expect(screen.queryByText(/^Resolved$/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/After image shows repaired road surface/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /limitations/ }));
    expect(
      screen.getByText(
        /does not prove that a real-world problem has been permanently fixed/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Completion document \(suggested\)/)).toBeInTheDocument();
  });

  it('frames concerns as checks, not accusations', () => {
    render(
      <AiVerificationReview
        assessment={assessment({
          concerns: [
            {
              code: 'AFTER_MATCHES_BEFORE',
              text: 'An after-photo is nearly identical to the original.',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Potential evidence concern')).toBeInTheDocument();
    expect(screen.getByText(/not accusations/)).toBeInTheDocument();
  });

  it('says plainly when no AI review is available', () => {
    render(
      <AiVerificationReview
        assessment={assessment({
          status: 'UNAVAILABLE',
          recommendation: null,
          confidence: null,
        })}
      />,
    );
    expect(
      screen.getByText(/No AI model ran — review the evidence directly/),
    ).toBeInTheDocument();
  });
});

describe('EvidenceCard', () => {
  it('links raw files through the API and shows the government’s reason', () => {
    render(
      <EvidenceCard
        evidence={evidence({
          status: 'NEEDS_MORE_EVIDENCE',
          decisionReason: 'Please add the inspection report.',
        })}
        onWithdraw={() => undefined}
      />,
    );
    expect(screen.getByRole('img', { name: /after photo 1/ })).toHaveAttribute(
      'src',
      '/api/v1/evidence/e1/files/f1',
    );
    expect(screen.getByText('Please add the inspection report.')).toBeInTheDocument();
    expect(screen.getByText(/18 m from report \(metadata\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Run AI review again/ }),
    ).not.toBeInTheDocument();
  });

  it('shows a running review', () => {
    render(
      <EvidenceCard evidence={evidence({ aiStatus: 'PROCESSING', assessment: null })} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('AI review: processing');
  });
});

describe('EvidenceUploadDialog', () => {
  it('checks files before upload', () => {
    expect(checkFile(new File(['x'], 'tool.exe'))).toMatch(/Use a JPEG/);
    expect(checkFile(new File(['x'], 'page.html'))).toMatch(/Use a JPEG/);
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    });
    expect(checkFile(big)).toMatch(/Larger than 10 MB/);
    expect(checkFile(new File(['x'], 'after.jpg', { type: 'image/jpeg' }))).toBeNull();
  });

  it('creates a draft, uploads each file with progress, retries failures, then submits', async () => {
    service.createEvidence.mockResolvedValue(
      evidence({ id: 'draft', status: 'DRAFT', files: [] }),
    );
    service.uploadEvidenceFile
      .mockRejectedValueOnce(
        new ApiError({
          code: 'VALIDATION_FAILED',
          message: 'Network hiccup.',
          status: 500,
        }),
      )
      .mockImplementation(
        async (
          _id: string,
          _file: File,
          _role: string,
          progress: (p: number) => void,
        ) => {
          progress(0.5);
          progress(1);
          return evidence({ id: 'draft', status: 'DRAFT' });
        },
      );
    service.submitEvidence.mockResolvedValue(evidence({ status: 'SUBMITTED' }));
    const onSubmitted = vi.fn();
    render(
      <EvidenceUploadDialog
        projectId="p1"
        open
        onClose={() => undefined}
        onSubmitted={onSubmitted}
      />,
    );

    await userEvent.type(screen.getByLabelText(/Title/), 'Road repaired');
    await userEvent.upload(
      screen.getByLabelText('Choose evidence files'),
      new File(['jpeg'], 'after.jpg', { type: 'image/jpeg' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Upload and submit' }));
    expect(await screen.findByText('Network hiccup.')).toBeInTheDocument();
    expect(service.submitEvidence).not.toHaveBeenCalled();
    expect(service.createEvidence).toHaveBeenCalledWith('p1', {
      evidenceType: 'AFTER_IMAGE',
      title: 'Road repaired',
      description: null,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Retry after.jpg' }));
    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Upload and submit' }));
    await waitFor(() => expect(service.submitEvidence).toHaveBeenCalledWith('draft'));
    expect(onSubmitted).toHaveBeenCalled();
    expect(service.createEvidence).toHaveBeenCalledTimes(1);
  });
});

function projectView(
  overrides: Partial<ProjectVerificationView> = {},
): ProjectVerificationView {
  return {
    evidence: [evidence()],
    request: null,
    history: [],
    missingEvidence: assessment().missingEvidence,
    timeline: [
      {
        id: 't1',
        action: 'EVIDENCE_SUBMITTED',
        text: 'Evidence submitted: “Road repair completed”',
        actor: { name: 'Rahul', side: 'ORGANIZATION' },
        createdAt: '2026-10-07T08:00:00.000Z',
      },
    ],
    canSubmitEvidence: true,
    canRequestVerification: true,
    requestBlockers: [],
    problemStatus: 'IN_PROGRESS',
    limitations: [],
    ...overrides,
  };
}

describe('ProjectEvidencePanel', () => {
  it('lets managers request verification', async () => {
    service.fetchProjectVerification.mockResolvedValue(projectView());
    service.requestVerification.mockResolvedValue(projectView());
    render(<ProjectEvidencePanel projectId="p1" />);
    await userEvent.type(
      await screen.findByLabelText(/Note for the office/),
      'All done.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Request verification' }));
    await waitFor(() =>
      expect(service.requestVerification).toHaveBeenCalledWith('p1', 'All done.'),
    );
    expect(screen.getByText(/Verification history/)).toBeInTheDocument();
  });

  it('explains why verification cannot be requested yet', async () => {
    service.fetchProjectVerification.mockResolvedValue(
      projectView({
        canRequestVerification: false,
        requestBlockers: ['The AI review of 1 evidence item is still running.'],
      }),
    );
    render(<ProjectEvidencePanel projectId="p1" />);
    expect(await screen.findByText(/still running/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request verification' }),
    ).not.toBeInTheDocument();
  });
});

function governmentView(
  overrides: Partial<GovernmentVerificationView> = {},
): GovernmentVerificationView {
  return {
    problem: {
      publicId: 'SAM-1042',
      title: 'Pothole',
      description: 'Deep pothole.',
      category: 'POTHOLES',
      status: 'IN_PROGRESS',
      reportedAt: '2026-10-01T08:00:00.000Z',
      resolvedAt: null,
      beforeImages: [{ url: '/media/problems/x.jpg' }],
    },
    project: {
      id: 'p1',
      roomId: 'r1',
      name: 'Pothole repair',
      status: 'ACTIVE',
      organizationName: 'Clean City',
      taskProgress: 100,
      openTasks: 0,
      completedTasks: 3,
      milestones: [],
    },
    evidence: [evidence({ status: 'UNDER_GOVERNMENT_REVIEW' })],
    request: {
      id: 'q1',
      status: 'PENDING',
      note: null,
      requestedBy: 'Asha',
      governmentName: 'Pune MC',
      createdAt: '2026-10-07T09:00:00.000Z',
      decidedAt: null,
      decisionReason: null,
      decisionNote: null,
      evidenceCount: 1,
    },
    history: [],
    rollup: {
      recommendation: 'LIKELY_RESOLVED',
      confidence: 0.86,
      evidenceQuality: 84,
      conflicting: false,
      concerns: [],
    },
    missingEvidence: [],
    timeline: [],
    canDecide: true,
    approvalBlockers: [],
    limitations: [],
    ...overrides,
  };
}

describe('GovernmentVerificationPanel', () => {
  it('shows evidence and the advisory review, and requires a reason to reject', async () => {
    service.fetchGovernmentVerification.mockResolvedValue(governmentView());
    service.rejectResolution.mockResolvedValue(
      governmentView({ canDecide: false, request: null }),
    );
    render(<GovernmentVerificationPanel slug="pune" publicId="SAM-1042" />);
    expect(await screen.findByText(/AI verification — advisory/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Report photo B1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reject resolution' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Too short');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reject resolution' }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /at least 10 characters/,
    );
    expect(service.rejectResolution).not.toHaveBeenCalled();
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/),
      ' — wrong road in the photo.',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reject resolution' }),
    );
    await waitFor(() =>
      expect(service.rejectResolution).toHaveBeenCalledWith(
        'pune',
        'SAM-1042',
        'Too short — wrong road in the photo.',
      ),
    );
  });

  it('blocks approval while tasks are open, but allows asking for more', async () => {
    service.fetchGovernmentVerification.mockResolvedValue(
      governmentView({ approvalBlockers: ['1 task is still open.'] }),
    );
    render(<GovernmentVerificationPanel slug="pune" publicId="SAM-1042" />);
    expect(
      await screen.findByRole('button', { name: 'Approve resolution' }),
    ).toBeDisabled();
    expect(screen.getByText('1 task is still open.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request more evidence' })).toBeEnabled();
  });

  it('approves with an optional note', async () => {
    service.fetchGovernmentVerification.mockResolvedValue(governmentView());
    service.approveResolution.mockResolvedValue(governmentView({ canDecide: false }));
    render(<GovernmentVerificationPanel slug="pune" publicId="SAM-1042" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve resolution' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Approve resolution' }),
    );
    await waitFor(() =>
      expect(service.approveResolution).toHaveBeenCalledWith(
        'pune',
        'SAM-1042',
        undefined,
      ),
    );
  });

  it('renders nothing before this office has a project', async () => {
    service.fetchGovernmentVerification.mockResolvedValue(
      governmentView({ project: null, canDecide: false }),
    );
    const { container } = render(
      <GovernmentVerificationPanel slug="pune" publicId="SAM-1042" />,
    );
    await waitFor(() => expect(service.fetchGovernmentVerification).toHaveBeenCalled());
    expect(container).not.toHaveTextContent('Resolution verification');
  });
});

describe('citizen view', () => {
  it('shows a verified resolution — and nothing private', () => {
    render(
      <ProblemResolutionCard
        resolution={{
          resolvedAt: '2026-10-10T09:00:00.000Z',
          verifiedBy: 'Pune Municipal Corporation',
        }}
      />,
    );
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Pune Municipal Corporation')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/AI|confidence|evidence quality/i);
  });

  it('shows work progress on the assignment', () => {
    render(
      <ProblemAssignmentCard
        assignment={{
          organization: { slug: 'cc', name: 'Clean City', type: 'NGO', logoUrl: null },
          assignedAt: '2026-10-02T09:00:00.000Z',
          progress: 72,
        }}
      />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Work progress' }),
    ).toBeInTheDocument();
  });
});
