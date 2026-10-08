import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type {
  MilestoneView,
  ProjectSummary,
  ProjectView,
  TaskView,
} from '@samadhaan/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { describeProjectActivity } from '@/lib/project';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { MilestoneList } from './milestone-list';
import { ProjectCard } from './project-card';
import { ProjectWorkspace } from './project-workspace';
import { TaskTable } from './task-table';

const service = vi.hoisted(() => ({
  fetchProject: vi.fn(),
  fetchTasks: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchAssignees: vi.fn(),
  fetchProjectActivity: vi.fn(),
  changeTaskStatus: vi.fn(),
  changeProjectStatus: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateProject: vi.fn(),
  createMilestone: vi.fn(),
  setMilestoneCompleted: vi.fn(),
}));
vi.mock('@/services/project.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/project.service')>()),
  ...service,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const AARAV = '11111111-1111-4111-8111-111111111111';

const overview = {
  tasks: {
    total: 19,
    todo: 6,
    inProgress: 3,
    blocked: 1,
    completed: 8,
    cancelled: 0,
    overdue: 1,
  },
  taskProgress: 42,
  milestones: { total: 4, completed: 2, overdue: 0 },
  milestoneProgress: 50,
};

function projectView(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: 'p1',
    roomId: 'r1',
    name: 'Resolve: Large pothole causing traffic disruption',
    description:
      'Resolution project for "Large pothole causing traffic disruption", reported at Sector 48, Gurgaon.',
    status: 'ACTIVE',
    startDate: '2026-10-06',
    targetDate: '2026-10-20',
    startedAt: '2026-10-06T11:30:00.000Z',
    completedAt: null,
    cancelledAt: null,
    createdAt: '2026-10-06T11:20:00.000Z',
    updatedAt: '2026-10-06T11:30:00.000Z',
    version: 3,
    problem: {
      publicId: 'SAM-1023',
      title: 'Large pothole causing traffic disruption',
      status: 'IN_PROGRESS',
      category: 'POTHOLES',
      subcategory: 'Road surface cavity',
      area: 'Sector 48',
    },
    government: { name: 'Gurgaon Municipal Corporation' },
    organization: { name: 'RoadSafe Foundation', slug: 'roadsafe' },
    overview,
    viewer: { userId: AARAV, side: 'ORGANIZATION', role: 'ADMIN' },
    permissions: {
      canManage: true,
      canUpdateOwnTasks: true,
      isEditable: true,
      allowedTransitions: ['PAUSED', 'COMPLETED', 'CANCELLED'],
    },
    today: '2026-10-08',
    ...overrides,
  };
}

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: 't1',
    title: 'Inspect affected road section',
    description: null,
    status: 'TODO',
    priority: 'HIGH',
    assignee: { userId: AARAV, name: 'Aarav Sharma', avatarUrl: null },
    milestone: { id: 'm1', title: 'Site inspection' },
    dueDate: '2026-10-07',
    overdue: true,
    startedAt: null,
    completedAt: null,
    completedBy: null,
    cancelledAt: null,
    createdBy: { userId: AARAV, name: 'Aarav Sharma', avatarUrl: null },
    createdAt: '2026-10-06T11:30:00.000Z',
    updatedAt: '2026-10-06T11:30:00.000Z',
    version: 1,
    attachments: [],
    allowedTransitions: ['IN_PROGRESS', 'CANCELLED'],
    canEdit: true,
    ...overrides,
  };
}

function milestone(overrides: Partial<MilestoneView> = {}): MilestoneView {
  return {
    id: 'm1',
    title: 'Site inspection',
    description: null,
    dueDate: '2026-10-10',
    status: 'IN_PROGRESS',
    completedAt: null,
    completedBy: null,
    tasks: { total: 3, completed: 2, cancelled: 0, open: 1 },
    progress: 66,
    version: 1,
    createdAt: '2026-10-06T11:30:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset();
  service.fetchTasks.mockResolvedValue({
    items: [
      task(),
      task({
        id: 't2',
        title: 'Site visit',
        status: 'IN_PROGRESS',
        overdue: false,
        allowedTransitions: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
      }),
    ],
    page: 1,
    limit: 200,
    totalCount: 2,
    totalPages: 1,
  });
  service.fetchMilestones.mockResolvedValue([milestone()]);
  service.fetchAssignees.mockResolvedValue([
    { userId: AARAV, name: 'Aarav Sharma', avatarUrl: null, membershipRole: 'ADMIN' },
  ]);
  service.fetchProjectActivity.mockResolvedValue({
    items: [
      {
        id: 'e1',
        kind: 'PROJECT_CREATED',
        actor: null,
        subject: null,
        from: null,
        to: null,
        detail: null,
        createdAt: '2026-10-06T11:20:00.000Z',
      },
    ],
    nextCursor: null,
  });
  service.fetchProject.mockResolvedValue(projectView());
});

describe('ProjectWorkspace', () => {
  it('shows the header and real progress', async () => {
    render(<ProjectWorkspace initial={projectView()} />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Resolve: Large pothole causing traffic disruption',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('SAM-1023')).toBeInTheDocument();
    expect(screen.getByText(/RoadSafe Foundation/)).toBeInTheDocument();
    expect(screen.getByText('42% · 8/19')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: '42% of tasks completed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('8 / 19 completed')).toBeInTheDocument();
    expect(screen.getByText('2 / 4 completed')).toBeInTheDocument();
    expect(
      await screen.findAllByRole('article', { name: 'Inspect affected road section' }),
    ).toHaveLength(1);
  });

  it('offers only the moves the API allows, as buttons', async () => {
    service.changeTaskStatus.mockResolvedValue(task({ status: 'IN_PROGRESS' }));
    render(<ProjectWorkspace initial={projectView()} />);
    const card = await screen.findByRole('article', {
      name: 'Inspect affected road section',
    });
    expect(
      within(card).queryByRole('button', { name: /Complete:/ }),
    ).not.toBeInTheDocument();
    expect(within(card).getByText('Overdue')).toBeInTheDocument();
    await userEvent.click(
      within(card).getByRole('button', { name: 'Start: Inspect affected road section' }),
    );
    expect(service.changeTaskStatus).toHaveBeenCalledWith('p1', 't1', 'IN_PROGRESS');
    await waitFor(() => expect(service.fetchProject).toHaveBeenCalled());
  });

  it('switches to an accessible table', async () => {
    render(<ProjectWorkspace initial={projectView()} />);
    await screen.findByRole('article', { name: 'Inspect affected road section' });
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    const table = screen.getByRole('table', { name: 'Project tasks' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Task',
      'Status',
      'Priority',
      'Assignee',
      'Due date',
      'Updated',
      'Actions',
    ]);
    expect(
      within(table).getByRole('rowheader', { name: /Site visit/ }),
    ).toBeInTheDocument();
  });

  it('filters on the server', async () => {
    render(<ProjectWorkspace initial={projectView()} />);
    await screen.findByRole('article', { name: 'Inspect affected road section' });
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'CRITICAL');
    await waitFor(() =>
      expect(service.fetchTasks).toHaveBeenLastCalledWith('p1', {
        priority: ['CRITICAL'],
      }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Overdue only' }));
    await waitFor(() =>
      expect(service.fetchTasks).toHaveBeenLastCalledWith('p1', {
        priority: ['CRITICAL'],
        overdue: true,
      }),
    );
  });

  it('creates a task with an assignee from the organisation', async () => {
    service.createTask.mockResolvedValue(task({ id: 't3' }));
    render(<ProjectWorkspace initial={projectView()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create task' });
    await userEvent.type(
      within(dialog).getByLabelText(/Task title/),
      'Capture measurements',
    );
    await userEvent.selectOptions(within(dialog).getByLabelText(/Assignee/), AARAV);
    await userEvent.selectOptions(within(dialog).getByLabelText('Priority'), 'CRITICAL');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(service.createTask).toHaveBeenCalledWith('p1', {
      title: 'Capture measurements',
      description: null,
      priority: 'CRITICAL',
      assignedToId: AARAV,
      dueDate: null,
      milestoneId: null,
    });
  });

  it('refuses a due date before the project starts', async () => {
    render(<ProjectWorkspace initial={projectView()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create task' });
    await userEvent.type(within(dialog).getByLabelText(/Task title/), 'Old task');
    await userEvent.type(within(dialog).getByLabelText('Due date'), '2026-10-01');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'cannot be before the project starts',
    );
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('requires a reason to cancel the project', async () => {
    service.changeProjectStatus.mockResolvedValue(projectView({ status: 'CANCELLED' }));
    render(<ProjectWorkspace initial={projectView()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel project?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel project' }));
    expect(
      within(dialog).getByText('Give a reason for cancelling the project.'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Taken over by the city.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel project' }));
    expect(service.changeProjectStatus).toHaveBeenCalledWith(
      'p1',
      'CANCELLED',
      'Taken over by the city.',
    );
  });

  it('gives government oversight without planning controls', async () => {
    service.fetchTasks.mockResolvedValue({
      items: [task({ allowedTransitions: [], canEdit: false })],
      page: 1,
      limit: 200,
      totalCount: 1,
      totalPages: 1,
    });
    render(
      <ProjectWorkspace
        initial={projectView({
          viewer: { userId: 'gov', side: 'GOVERNMENT', role: 'OWNER' },
          permissions: {
            canManage: false,
            canUpdateOwnTasks: false,
            isEditable: true,
            allowedTransitions: [],
          },
        })}
      />,
    );
    expect(
      screen.getByText(/viewing the assigned organisation’s plan/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Project status' }),
    ).not.toBeInTheDocument();
    const card = await screen.findByRole('article', {
      name: 'Inspect affected road section',
    });
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    // Government may still rename the project.
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
  });

  it('links back to the resolution room', () => {
    render(<ProjectWorkspace initial={projectView()} />);
    expect(screen.getByRole('link', { name: 'Discuss in the room' })).toHaveAttribute(
      'href',
      '/resolution/r1',
    );
  });

  it('uses tabs on small screens', async () => {
    render(<ProjectWorkspace initial={projectView()} />);
    const tabs = screen.getByRole('tablist', { name: 'Project sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Summary', 'Tasks', 'Milestones', 'Evidence', 'Activity']);
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Milestones' }));
    expect(within(tabs).getByRole('tab', { name: 'Milestones' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('MilestoneList', () => {
  it('blocks completion while tasks are open, and says why', () => {
    render(
      <MilestoneList
        milestones={[milestone()]}
        canManage
        minDate={null}
        onCreate={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeDisabled();
    expect(screen.getByText('1 open task left.')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Site inspection: 66% of tasks done' }),
    ).toBeInTheDocument();
  });

  it('completes and reopens', async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(
      <MilestoneList
        milestones={[
          milestone({ tasks: { total: 3, completed: 3, cancelled: 0, open: 0 } }),
          milestone({
            id: 'm2',
            title: 'Repair',
            status: 'COMPLETED',
            completedAt: '2026-10-07T00:00:00Z',
          }),
        ]}
        canManage
        minDate={null}
        onCreate={vi.fn()}
        onToggle={onToggle}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), true);
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }), false);
  });

  it('shows derived status in words', () => {
    render(
      <MilestoneList
        milestones={[milestone({ status: 'OVERDUE' })]}
        canManage={false}
        minDate={null}
        onCreate={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('TaskTable', () => {
  it('marks overdue in text, not colour alone', () => {
    render(
      <TaskTable tasks={[task()]} busyId={null} onMove={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Priority:')).toHaveClass('sr-only');
  });
});

describe('ProjectCard', () => {
  it('summarises a live project from real counts', () => {
    const summary: ProjectSummary = {
      id: 'p1',
      roomId: 'r1',
      name: 'Resolve: Large pothole',
      status: 'ACTIVE',
      problemPublicId: 'SAM-1023',
      government: { name: 'Gurgaon MC' },
      organization: { name: 'RoadSafe' },
      targetDate: '2026-10-20',
      overview,
    };
    render(<ProjectCard project={summary} partner="government" />);
    expect(screen.getByText('42% complete')).toBeInTheDocument();
    expect(screen.getByText('8 / 19 tasks')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open project/ })).toHaveAttribute(
      'href',
      '/resolution/r1/project',
    );
  });
});

describe('describeProjectActivity', () => {
  const entry = {
    id: 'e',
    actor: { name: 'Neha Kapoor', organizationName: 'RoadSafe' },
    subject: 'Site visit',
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    detail: null,
    createdAt: '2026-10-06T11:22:00.000Z',
  };
  it('words structured events', () => {
    expect(describeProjectActivity({ ...entry, kind: 'TASK_STATUS_CHANGED' })).toBe(
      'Neha Kapoor marked “Site visit” completed',
    );
    expect(
      describeProjectActivity({
        ...entry,
        kind: 'TASK_ASSIGNED',
        detail: 'Aarav Sharma',
      }),
    ).toBe('Neha Kapoor assigned “Site visit” to Aarav Sharma');
    expect(
      describeProjectActivity({
        ...entry,
        kind: 'PROJECT_STATUS_CHANGED',
        from: 'PAUSED',
        to: 'ACTIVE',
      }),
    ).toBe('Neha Kapoor resumed the project');
  });
});
