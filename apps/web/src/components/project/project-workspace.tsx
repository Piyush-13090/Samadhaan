'use client';

import { ArrowLeft, LayoutGrid, List, MessagesSquare, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type MilestoneView,
  type ProjectActivityEntry,
  type ProjectAssignee,
  type ProjectStatus,
  type ProjectView,
  type TaskPriority,
  type TaskStatus,
  type TaskView,
} from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CheckboxField } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import {
  PROJECT_ACTION_LABEL,
  TASK_PRIORITY_DISPLAY,
  TASK_STATUS_DISPLAY,
  formatDay,
} from '@/lib/project';
import { roomPath } from '@/lib/resolution';
import {
  changeProjectStatus,
  changeTaskStatus,
  createMilestone,
  createTask,
  fetchAssignees,
  fetchMilestones,
  fetchProject,
  fetchProjectActivity,
  fetchTasks,
  setMilestoneCompleted,
  updateProject,
  updateTask,
  type TaskInput,
  type TaskQuery,
} from '@/services/project.service';
import { AIProjectCoordinator } from '@/components/coordinator/ai-project-coordinator';
import { AskKnowledge } from '@/components/knowledge/ask-knowledge';
import { ProjectUpdates } from '@/components/coordinator/project-updates';
import { MilestoneList } from './milestone-list';
import { NativeSelect } from './native-select';
import { ProjectActivity, ProjectTimeline } from './project-activity';
import { ProjectStatusBadge } from './project-badges';
import { ProjectOverview } from './project-overview';
import { TaskBoard } from './task-board';
import { TaskDialog } from './task-dialog';
import { TaskTable } from './task-table';

type Tab = 'summary' | 'tasks' | 'milestones' | 'activity';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'activity', label: 'Activity' },
];

/**
 * A resolution project: header, overview, tasks (board or table), milestones,
 * timeline and activity. Each section loads on its own — the page never
 * fetches every task, event and message at once.
 */
export function ProjectWorkspace({ initial }: { initial: ProjectView }) {
  const { toast } = useToast();
  const [project, setProject] = useState(initial);
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [taskError, setTaskError] = useState(false);
  const [milestones, setMilestones] = useState<MilestoneView[] | null>(null);
  const [assignees, setAssignees] = useState<ProjectAssignee[]>([]);
  const [activity, setActivity] = useState<ProjectActivityEntry[] | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState<TaskQuery>({});
  const [view, setView] = useState<'board' | 'list'>('board');
  const [tab, setTab] = useState<Tab>('tasks');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskView | 'new' | null>(null);
  const [statusTarget, setStatusTarget] = useState<ProjectStatus | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  // Bumped after any change, so the coordinator's live health recomputes.
  const [reloadKey, setReloadKey] = useState(0);
  const id = project.id;
  const { permissions } = project;
  const canEditDetails =
    permissions.isEditable &&
    (permissions.canManage || project.viewer.side === 'GOVERNMENT');

  const loadTasks = useCallback(
    () =>
      fetchTasks(id, query)
        .then((page) => {
          setTasks(page.items);
          setTaskError(false);
        })
        .catch(() => setTaskError(true)),
    [id, query],
  );
  const loadMilestones = useCallback(
    () =>
      fetchMilestones(id)
        .then(setMilestones)
        .catch(() => undefined),
    [id],
  );
  const loadActivity = useCallback(
    () =>
      fetchProjectActivity(id)
        .then((page) => {
          setActivity(page.items);
          setActivityCursor(page.nextCursor);
        })
        .catch(() => undefined),
    [id],
  );
  const loadProject = useCallback(
    () =>
      fetchProject(id)
        .then(setProject)
        .catch(() => undefined),
    [id],
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);
  useEffect(() => {
    void loadMilestones();
    void loadActivity();
    fetchAssignees(id)
      .then(setAssignees)
      .catch(() => undefined);
  }, [id, loadMilestones, loadActivity]);

  /** After any change: the numbers, the milestones and the feed. */
  function refreshAll() {
    setReloadKey((k) => k + 1);
    void loadProject();
    void loadTasks();
    void loadMilestones();
    void loadActivity();
  }

  function fail(caught: unknown, fallback: string) {
    toast({
      tone: 'danger',
      title: fallback,
      description: caught instanceof ApiError ? caught.message : undefined,
    });
  }

  async function moveTask(task: TaskView, to: TaskStatus) {
    setBusyTask(task.id);
    try {
      await changeTaskStatus(id, task.id, to);
      toast({
        tone: 'success',
        title: `“${task.title}” is now ${TASK_STATUS_DISPLAY[to].label.toLowerCase()}`,
      });
    } catch (caught) {
      fail(caught, 'Could not update the task');
    } finally {
      setBusyTask(null);
      refreshAll();
    }
  }

  async function saveTask(input: TaskInput, task: TaskView | null) {
    if (task) {
      await updateTask(id, task.id, { ...input, version: task.version });
      toast({ tone: 'success', title: 'Task saved' });
    } else {
      await createTask(id, input);
      toast({
        tone: 'success',
        title: 'Task created',
        description: input.assignedToId ? 'The assignee has been notified.' : undefined,
      });
    }
    refreshAll();
  }

  const counted = project.overview.tasks.total - project.overview.tasks.cancelled;
  const openTasks =
    project.overview.tasks.todo +
    project.overview.tasks.inProgress +
    project.overview.tasks.blocked;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={roomPath(project.roomId)}
            className="inline-flex items-center gap-1 type-caption font-medium text-primary underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Resolution room
          </Link>
          <div className="flex flex-wrap gap-2">
            {canEditDetails && (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<Pencil />}
                onClick={() => setEditingDetails(true)}
              >
                Edit details
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<MessagesSquare />}
              asChild
            >
              <Link href={roomPath(project.roomId)}>Discuss in the room</Link>
            </Button>
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono type-body-sm text-ink-subtle">
              {project.problem.publicId}
            </span>
            <CategoryBadge category={project.problem.category} size="sm" />
            {project.problem.subcategory && (
              <span className="type-caption text-ink-muted">
                → {project.problem.subcategory}
              </span>
            )}
            <ProjectStatusBadge status={project.status} />
          </div>
          <h1 className="mt-2 type-h1 text-ink">{project.name}</h1>
          {project.description && (
            <p className="mt-1 max-w-3xl type-body text-ink-muted">
              {project.description}
            </p>
          )}
          <p className="mt-2 type-body-sm text-ink-muted">
            {project.organization.name} <span aria-hidden="true">×</span>
            <span className="sr-only">with</span> {project.government.name}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 type-body-sm">
          <div>
            <dt className="type-caption text-ink-subtle">Start</dt>
            <dd className="text-ink">{formatDay(project.startDate)}</dd>
          </div>
          <div>
            <dt className="type-caption text-ink-subtle">Target</dt>
            <dd className="text-ink">{formatDay(project.targetDate)}</dd>
          </div>
          <div className="min-w-48 flex-1">
            <dt className="type-caption text-ink-subtle">Progress</dt>
            <dd className="mt-1 flex items-center gap-3">
              <ProgressBar
                className="flex-1"
                size="sm"
                value={project.overview.taskProgress}
                label={`${project.overview.taskProgress}% of tasks completed`}
              />
              <span className="tabular text-ink">
                {project.overview.taskProgress}% · {project.overview.tasks.completed}/
                {counted}
              </span>
            </dd>
          </div>
        </dl>
        {permissions.allowedTransitions.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Project status">
            {permissions.allowedTransitions.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={
                  to === 'CANCELLED'
                    ? 'ghost'
                    : to === 'COMPLETED' || to === 'ACTIVE'
                      ? 'primary'
                      : 'secondary'
                }
                disabled={to === 'COMPLETED' && openTasks > 0}
                onClick={() => setStatusTarget(to)}
              >
                {to === 'ACTIVE' && project.status === 'PAUSED'
                  ? 'Resume'
                  : PROJECT_ACTION_LABEL[to]}
              </Button>
            ))}
          </div>
        )}
        {permissions.allowedTransitions.includes('COMPLETED') && openTasks > 0 && (
          <p className="type-caption text-ink-subtle">
            To complete the project, finish or cancel its {openTasks} open{' '}
            {openTasks === 1 ? 'task' : 'tasks'}.
          </p>
        )}
        {project.viewer.side === 'GOVERNMENT' && (
          <p className="type-caption text-ink-subtle">
            You are viewing the assigned organisation’s plan. Discuss changes in the
            resolution room.
          </p>
        )}
      </header>

      {/* --------------------------------------------- phone: section tabs */}
      <div
        role="tablist"
        aria-label="Project sections"
        className="flex gap-1 overflow-x-auto border-b border-border lg:hidden"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            id={`project-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`project-panel-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 type-body-sm font-medium',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
              tab === entry.id
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <div
            id="project-panel-summary"
            role="tabpanel"
            aria-labelledby="project-tab-summary"
            className={cn(tab !== 'summary' && 'hidden', 'lg:block')}
          >
            <div className="space-y-6">
              <AIProjectCoordinator
                projectId={id}
                canDismiss={permissions.canManage || project.viewer.side === 'GOVERNMENT'}
                reloadKey={reloadKey}
              />
              <ProjectOverview project={project} />
              <AskKnowledge projectId={id} />
              <ProjectUpdates
                projectId={id}
                canPost={project.viewer.side === 'ORGANIZATION' && permissions.isEditable}
                onPosted={() => {
                  setReloadKey((k) => k + 1);
                  void loadActivity();
                }}
              />
            </div>
          </div>

          {/* -------------------------------------------------- tasks */}
          <section
            id="project-panel-tasks"
            role="tabpanel"
            aria-labelledby="project-tab-tasks"
            className={cn(tab !== 'tasks' && 'hidden', 'lg:block')}
          >
            <Card>
              <CardHeader
                title="Tasks"
                description={`${project.overview.tasks.total} tasks · ${project.overview.tasks.overdue} overdue`}
                action={
                  <div className="flex items-center gap-1">
                    <div
                      role="group"
                      aria-label="Task view"
                      className="flex rounded-control bg-subtle p-0.5"
                    >
                      <Button
                        variant={view === 'board' ? 'subtle' : 'ghost'}
                        size="sm"
                        leadingIcon={<LayoutGrid />}
                        aria-pressed={view === 'board'}
                        onClick={() => setView('board')}
                      >
                        Board
                      </Button>
                      <Button
                        variant={view === 'list' ? 'subtle' : 'ghost'}
                        size="sm"
                        leadingIcon={<List />}
                        aria-pressed={view === 'list'}
                        onClick={() => setView('list')}
                      >
                        List
                      </Button>
                    </div>
                    {permissions.canManage && permissions.isEditable && (
                      <Button
                        size="sm"
                        variant="primary"
                        leadingIcon={<Plus />}
                        onClick={() => setEditing('new')}
                      >
                        Create task
                      </Button>
                    )}
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <TaskFilters query={query} assignees={assignees} onChange={setQuery} />
                {taskError ? (
                  <ErrorState
                    size="sm"
                    title="Tasks could not be loaded"
                    onRetry={() => void loadTasks()}
                  />
                ) : tasks === null ? (
                  <p className="type-body-sm text-ink-muted">Loading tasks…</p>
                ) : tasks.length === 0 ? (
                  <EmptyState
                    size="sm"
                    title={
                      Object.keys(query).length
                        ? 'No tasks match these filters'
                        : 'No tasks yet'
                    }
                    description={
                      permissions.canManage
                        ? 'Create the first task — for example, inspect the affected area.'
                        : 'The assigned organisation has not added tasks yet.'
                    }
                  />
                ) : view === 'board' ? (
                  <TaskBoard
                    tasks={tasks}
                    busyId={busyTask}
                    onMove={moveTask}
                    onEdit={(t) => setEditing(t)}
                  />
                ) : (
                  <TaskTable
                    tasks={tasks}
                    busyId={busyTask}
                    onMove={moveTask}
                    onEdit={(t) => setEditing(t)}
                  />
                )}
                {tasks &&
                  view === 'board' &&
                  tasks.some((t) => t.status === 'CANCELLED') && (
                    <p className="type-caption text-ink-subtle">
                      Cancelled tasks are shown in the list view and do not count towards
                      progress.
                    </p>
                  )}
              </CardBody>
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <div
            id="project-panel-milestones"
            role="tabpanel"
            aria-labelledby="project-tab-milestones"
            className={cn(tab !== 'milestones' && 'hidden', 'lg:block')}
          >
            <MilestoneList
              milestones={milestones}
              canManage={permissions.canManage && permissions.isEditable}
              minDate={project.startDate}
              onCreate={async (input) => {
                setMilestones(await createMilestone(id, input));
                refreshAll();
              }}
              onToggle={async (milestone, complete) => {
                try {
                  setMilestones(await setMilestoneCompleted(id, milestone.id, complete));
                  if (complete)
                    toast({
                      tone: 'success',
                      title: `Milestone “${milestone.title}” completed`,
                    });
                } catch (caught) {
                  fail(caught, 'Could not update the milestone');
                }
                refreshAll();
              }}
            />
          </div>
          <div
            id="project-panel-activity"
            role="tabpanel"
            aria-labelledby="project-tab-activity"
            className={cn(tab !== 'activity' && 'hidden', 'space-y-6 lg:block')}
          >
            <Card>
              <CardHeader
                title="Timeline"
                description="Key moments, from recorded events."
              />
              <CardBody>
                <ProjectTimeline entries={activity} />
              </CardBody>
            </Card>
            <Card id="activity" className="scroll-mt-24">
              <CardHeader title="Recent activity" />
              <CardBody>
                <ProjectActivity
                  entries={activity}
                  hasMore={activityCursor !== null}
                  loadingMore={loadingMore}
                  onLoadMore={() => {
                    setLoadingMore(true);
                    fetchProjectActivity(id, activityCursor)
                      .then((page) => {
                        setActivity((current) => [...(current ?? []), ...page.items]);
                        setActivityCursor(page.nextCursor);
                      })
                      .catch(() => undefined)
                      .finally(() => setLoadingMore(false));
                  }}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      <TaskDialog
        open={editing !== null}
        task={editing === 'new' ? null : editing}
        assignees={assignees}
        milestones={milestones ?? []}
        minDate={project.startDate}
        onClose={() => setEditing(null)}
        onSave={saveTask}
      />
      <StatusDialog
        project={project}
        target={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={(updated) => {
          setProject(updated);
          refreshAll();
        }}
      />
      <DetailsDialog
        open={editingDetails}
        project={project}
        canEditDates={permissions.canManage}
        onClose={() => setEditingDetails(false)}
        onSaved={(updated) => {
          setProject(updated);
          void loadActivity();
        }}
      />
    </div>
  );
}

function TaskFilters({
  query,
  assignees,
  onChange,
}: {
  query: TaskQuery;
  assignees: ProjectAssignee[];
  onChange: (query: TaskQuery) => void;
}) {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      role="group"
      aria-label="Filter tasks"
    >
      <Field label="Status">
        <NativeSelect
          value={query.status?.[0] ?? ''}
          onChange={(e) =>
            onChange({
              ...query,
              status: e.target.value ? [e.target.value as TaskStatus] : undefined,
            })
          }
        >
          <option value="">Any status</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_DISPLAY[s].label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Priority">
        <NativeSelect
          value={query.priority?.[0] ?? ''}
          onChange={(e) =>
            onChange({
              ...query,
              priority: e.target.value ? [e.target.value as TaskPriority] : undefined,
            })
          }
        >
          <option value="">Any priority</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_DISPLAY[p].label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Assignee">
        <NativeSelect
          value={query.assignee ?? ''}
          onChange={(e) => onChange({ ...query, assignee: e.target.value || undefined })}
        >
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex items-end pb-2">
        <CheckboxField
          label="Overdue only"
          checked={query.overdue ?? false}
          onCheckedChange={(checked) =>
            onChange({ ...query, overdue: checked === true || undefined })
          }
        />
      </div>
    </div>
  );
}

function StatusDialog({
  project,
  target,
  onClose,
  onDone,
}: {
  project: ProjectView;
  target: ProjectStatus | null;
  onClose: () => void;
  onDone: (project: ProjectView) => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const reasonRequired = target === 'CANCELLED';
  const label =
    target === 'ACTIVE' && project.status === 'PAUSED'
      ? 'Resume'
      : target
        ? PROJECT_ACTION_LABEL[target]
        : '';

  async function confirm() {
    if (!target) return;
    if (reasonRequired && reason.trim().length === 0) {
      setError('Give a reason for cancelling the project.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      onDone(await changeProjectStatus(project.id, target, reason.trim() || undefined));
      toast({
        tone: 'success',
        title: `${label}: done`,
        description: 'Participants have been notified.',
      });
      setReason('');
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not change the project status.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={target !== null} onOpenChange={(value) => !value && onClose()}>
      <ModalContent
        size="md"
        title={`${label}?`}
        description={
          target === 'COMPLETED'
            ? 'All tasks are finished. Completing the project does not mark the civic problem resolved — that is verified separately.'
            : target === 'CANCELLED'
              ? 'The plan becomes read-only. This cannot be undone.'
              : target === 'PAUSED'
                ? 'Tasks cannot be started or completed until the project is resumed.'
                : 'Participants on both sides are notified.'
        }
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary" size="sm">
                Back
              </Button>
            </ModalClose>
            <Button
              variant={target === 'CANCELLED' ? 'danger' : 'primary'}
              size="sm"
              loading={pending}
              onClick={() => void confirm()}
            >
              {label}
            </Button>
          </>
        }
      >
        {(target === 'CANCELLED' || target === 'PAUSED') && (
          <Field
            label={reasonRequired ? 'Reason' : 'Reason (optional)'}
            required={reasonRequired}
            error={error ?? undefined}
          >
            <Textarea
              rows={2}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        {error && target !== 'CANCELLED' && target !== 'PAUSED' && (
          <p role="alert" className="type-body-sm text-danger">
            {error}
          </p>
        )}
      </ModalContent>
    </Modal>
  );
}

function DetailsDialog({
  open,
  project,
  canEditDates,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: ProjectView;
  canEditDates: boolean;
  onClose: () => void;
  onSaved: (project: ProjectView) => void;
}) {
  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()}>
      {open && (
        <DetailsForm
          project={project}
          canEditDates={canEditDates}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function DetailsForm({
  project,
  canEditDates,
  onClose,
  onSaved,
}: {
  project: ProjectView;
  canEditDates: boolean;
  onClose: () => void;
  onSaved: (project: ProjectView) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [targetDate, setTargetDate] = useState(project.targetDate ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    if (!name.trim()) {
      setError('Give the project a name.');
      return;
    }
    if (startDate && targetDate && targetDate < startDate) {
      setError('The target date cannot be before the start date.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      onSaved(
        await updateProject(project.id, {
          version: project.version,
          name: name.trim(),
          description: description.trim() || null,
          ...(canEditDates
            ? { startDate: startDate || null, targetDate: targetDate || null }
            : {}),
        }),
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalContent
      size="md"
      title="Project details"
      footer={
        <>
          <ModalClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </ModalClose>
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input
            value={name}
            maxLength={PROJECT_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            rows={3}
            value={description}
            maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {canEditDates && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="Target date">
              <Input
                type="date"
                value={targetDate}
                min={startDate || undefined}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </Field>
          </div>
        )}
        {error && (
          <p role="alert" className="type-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </ModalContent>
  );
}
