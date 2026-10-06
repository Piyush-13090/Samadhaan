import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { CoordinatorView, ExtractedUpdateView } from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { linesToItems } from '@/lib/coordinator';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { AIProjectCoordinator } from './ai-project-coordinator';
import { ProjectUpdates } from './project-updates';

const service = vi.hoisted(() => ({
  fetchCoordinator: vi.fn(),
  refreshInsights: vi.fn(),
  answerQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  draftUpdate: vi.fn(),
  fetchUpdates: vi.fn(),
  postUpdate: vi.fn(),
}));
vi.mock('@/services/coordinator.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/coordinator.service')>()),
  ...service,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const task = {
  kind: 'task' as const,
  id: 't1',
  label: 'Site inspection',
  href: '/resolution/r1/project#task-t1',
};
const message = {
  kind: 'message' as const,
  id: 'm1',
  label: 'Message from Aarav, 8 Oct',
  href: '/resolution/r1#message-m1',
};

function view(overrides: Partial<CoordinatorView> = {}): CoordinatorView {
  return {
    health: {
      level: 'AT_RISK',
      reasons: ['2 tasks are overdue'],
      signals: [
        {
          code: 'OVERDUE_TASK',
          severity: 'HIGH',
          title: '“Site inspection” is 1 day overdue',
          source: task,
        },
      ],
    },
    risks: [
      {
        type: 'OVERDUE_TASK',
        severity: 'HIGH',
        title: '“Site inspection” is 1 day overdue',
        description: '',
        sources: [task],
        origin: 'RULE',
      },
    ],
    blockers: [],
    deadlines: [
      {
        kind: 'milestone',
        title: 'Repair planning',
        dueDate: '2026-10-10',
        daysLeft: 2,
        source: null,
      },
    ],
    insight: {
      health: 'AT_RISK',
      healthReason: '2 tasks are overdue',
      summary: 'The site inspection is overdue and the repair permit is pending.',
      risks: [],
      blockers: [
        {
          title: 'Road permit not issued',
          description: 'The team says repair cannot start without it.',
          sources: [message],
          origin: 'AI',
        },
      ],
      suggestions: [{ text: 'Confirm the inspection result.', sources: [task] }],
      generatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      stale: false,
      model: {
        provider: 'anthropic',
        name: 'claude-x',
        version: 'claude-x',
        promptVersion: 'coordinator-2026-10-v1',
      },
    },
    lastFailure: null,
    questions: [
      {
        id: 'q1',
        question:
          'Was “Site inspection” completed? If not, what is preventing completion?',
        category: 'TASK_PROGRESS',
        status: 'OPEN',
        target: task,
        askedAt: new Date().toISOString(),
        answer: null,
        answeredAt: null,
        answeredBy: null,
      },
    ],
    refreshAvailableAt: null,
    canRefresh: true,
    canAnswer: true,
    canPostUpdates: true,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.fetchCoordinator.mockResolvedValue(view());
  service.fetchUpdates.mockResolvedValue({ items: [], nextCursor: null });
});

describe('AIProjectCoordinator', () => {
  it('shows live health with grounded reasons, and the dated AI summary', async () => {
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    expect(await screen.findByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('2 tasks are overdue')).toBeInTheDocument();
    expect(screen.getByText('Computed from current project data')).toBeInTheDocument();
    expect(screen.getByText(/repair permit is pending/)).toBeInTheDocument();
    expect(screen.getByText('Updated 12 minutes ago')).toBeInTheDocument();
    expect(screen.getByText(/claude-x \(anthropic\)/)).toBeInTheDocument();
    expect(screen.queryByText(/may be outdated/)).not.toBeInTheDocument();
  });

  it('labels AI-detected blockers as unconfirmed, and links every finding to its source', async () => {
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    const blockers = await screen.findByRole('region', { name: /Blockers/ });
    expect(
      within(blockers).getByText('AI-detected potential blocker — unconfirmed'),
    ).toBeInTheDocument();
    expect(
      within(blockers).getByRole('link', { name: 'Message · Message from Aarav, 8 Oct' }),
    ).toHaveAttribute('href', '/resolution/r1#message-m1');
    const risks = screen.getByRole('region', { name: /Risks/ });
    expect(
      within(risks).getByRole('link', { name: 'Task · Site inspection' }),
    ).toHaveAttribute('href', '/resolution/r1/project#task-t1');
  });

  it('warns when insights may be outdated, and shows the last failure', async () => {
    service.fetchCoordinator.mockResolvedValue(
      view({
        insight: { ...view().insight!, stale: true },
        lastFailure: {
          at: new Date().toISOString(),
          message: 'The coordinator result could not be understood.',
        },
      }),
    );
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    expect(await screen.findByText(/AI insights may be outdated/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be understood');
  });

  it('refreshes on request, and is disabled while cooling down', async () => {
    service.refreshInsights.mockResolvedValue(view());
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Refresh insights' }),
    );
    expect(service.refreshInsights).toHaveBeenCalledWith('p1');
  });

  it('cannot be refreshed during the cool-down', async () => {
    service.fetchCoordinator.mockResolvedValue(
      view({ refreshAvailableAt: new Date(Date.now() + 60_000).toISOString() }),
    );
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    expect(
      await screen.findByRole('button', { name: 'Refresh insights' }),
    ).toBeDisabled();
  });

  it('explains the empty state before any analysis', async () => {
    service.fetchCoordinator.mockResolvedValue(view({ insight: null, questions: [] }));
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    expect(await screen.findByText(/No AI insights yet/)).toBeInTheDocument();
    expect(screen.getByText('No open questions.')).toBeInTheDocument();
  });

  it('shows an error state when it cannot load', async () => {
    service.fetchCoordinator.mockRejectedValueOnce(new Error('down'));
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    expect(
      await screen.findByText('The coordinator could not be loaded'),
    ).toBeInTheDocument();
  });
});

describe('CoordinatorQuestions', () => {
  it('answers in one tap', async () => {
    service.answerQuestion.mockResolvedValue(view({ questions: [] }));
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, completed' }));
    expect(service.answerQuestion).toHaveBeenCalledWith('p1', 'q1', {
      quick: 'COMPLETED',
    });
  });

  it('asks why when the answer is “not yet”', async () => {
    service.answerQuestion.mockResolvedValue(view({ questions: [] }));
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not yet' }));
    const box = screen.getByLabelText('Your response');
    expect(box).toHaveAttribute('placeholder', 'What is preventing completion?');
    await userEvent.click(screen.getByRole('button', { name: 'Send response' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a response first.');
    await userEvent.type(box, 'Waiting for the road permit.');
    await userEvent.click(screen.getByRole('button', { name: 'Send response' }));
    expect(service.answerQuestion).toHaveBeenCalledWith('p1', 'q1', {
      quick: 'NOT_YET',
      answer: 'Waiting for the road permit.',
    });
  });

  it('offers dismiss to coordinators only', async () => {
    const { unmount } = render(
      <AIProjectCoordinator projectId="p1" canDismiss={false} reloadKey={0} />,
    );
    await screen.findByText(/Site inspection” completed/);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    unmount();
    service.dismissQuestion.mockResolvedValue(view({ questions: [] }));
    render(<AIProjectCoordinator projectId="p1" canDismiss reloadKey={0} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(service.dismissQuestion).toHaveBeenCalledWith('p1', 'q1');
  });
});

describe('ProjectUpdates', () => {
  const draft: ExtractedUpdateView = {
    summary: 'Inspection done; materials being ordered.',
    completed: ['Site inspection'],
    current: ['Material procurement'],
    blockers: [],
    nextSteps: ['Begin repair'],
    confidence: null,
    model: {
      provider: 'anthropic',
      name: 'claude-x',
      version: 'claude-x',
      promptVersion: 'update-extract-2026-10-v1',
    },
  };

  it('saves an AI draft only when accepted', async () => {
    service.draftUpdate.mockResolvedValue(draft);
    service.postUpdate.mockResolvedValue({});
    const onPosted = vi.fn();
    render(<ProjectUpdates projectId="p1" canPost onPosted={onPosted} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }));
    await userEvent.type(
      screen.getByLabelText('Your note'),
      'Inspection is done. Materials are being ordered today.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Draft from note' }));

    const suggestion = await screen.findByRole('region', { name: /AI suggested update/ });
    expect(within(suggestion).getByText('Site inspection')).toBeInTheDocument();
    expect(within(suggestion).getByText(/nothing is saved yet/)).toBeInTheDocument();
    expect(service.postUpdate).not.toHaveBeenCalled();

    await userEvent.click(
      within(suggestion).getByRole('button', { name: 'Accept update' }),
    );
    expect(service.postUpdate).toHaveBeenCalledWith('p1', {
      summary: draft.summary,
      completed: draft.completed,
      current: draft.current,
      blockers: [],
      nextSteps: draft.nextSteps,
      source: 'AI_ASSISTED',
      aiModel: 'claude-x',
    });
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
  });

  it('lets the author edit a draft before posting', async () => {
    service.draftUpdate.mockResolvedValue(draft);
    service.postUpdate.mockResolvedValue({});
    render(<ProjectUpdates projectId="p1" canPost onPosted={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Draft from recent room messages' }),
    );
    expect(service.draftUpdate).toHaveBeenCalledWith('p1', { fromRecentMessages: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const next = screen.getByLabelText('Next steps');
    expect(next).toHaveValue('Begin repair');
    await userEvent.clear(next);
    await userEvent.type(next, 'Begin repair on Friday');
    await userEvent.click(screen.getByRole('button', { name: 'Post update' }));
    expect(service.postUpdate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        nextSteps: ['Begin repair on Friday'],
        source: 'AI_ASSISTED',
      }),
    );
  });

  it('discards a dismissed draft', async () => {
    service.draftUpdate.mockResolvedValue(draft);
    render(<ProjectUpdates projectId="p1" canPost onPosted={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }));
    await userEvent.type(screen.getByLabelText('Your note'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Draft from note' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(
      screen.queryByRole('region', { name: /AI suggested update/ }),
    ).not.toBeInTheDocument();
    expect(service.postUpdate).not.toHaveBeenCalled();
  });

  it('shows a draft failure and keeps manual posting available', async () => {
    service.draftUpdate.mockRejectedValue(
      new ApiError({
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'The update draft could not be generated right now.',
        status: 503,
      }),
    );
    render(<ProjectUpdates projectId="p1" canPost onPosted={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }));
    await userEvent.type(screen.getByLabelText('Your note'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Draft from note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be generated');
  });

  it('is read-only for the government side', async () => {
    render(<ProjectUpdates projectId="p1" canPost={false} onPosted={vi.fn()} />);
    expect(await screen.findByText('No progress updates yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post update' })).not.toBeInTheDocument();
  });

  it('splits lines into items', () => {
    expect(linesToItems('- one\n\n• two \n three')).toEqual(['one', 'two', 'three']);
  });
});
