'use client';

import { CalendarDays, CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { TASK_TITLE_MAX_LENGTH, type MilestoneView } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';
import { EmptyState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { formatDay } from '@/lib/project';
import { MilestoneStatusBadge } from './project-badges';

/**
 * Milestones with their tasks' progress. Status (upcoming, in progress,
 * overdue, completed) is derived by the API from dates and tasks; the only
 * stored decision is completing one, which needs every task in it finished.
 */
export function MilestoneList({
  milestones,
  canManage,
  minDate,
  onCreate,
  onToggle,
}: {
  milestones: MilestoneView[] | null;
  canManage: boolean;
  minDate: string | null;
  onCreate: (input: {
    title: string;
    description: string | null;
    dueDate: string | null;
  }) => Promise<void>;
  onToggle: (milestone: MilestoneView, complete: boolean) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader
        title="Milestones"
        description="Stages of the work, each with its own tasks."
        action={
          canManage ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Plus />}
              onClick={() => setCreating(true)}
            >
              Add milestone
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {milestones === null ? (
          <p className="type-body-sm text-ink-muted">Loading milestones…</p>
        ) : milestones.length === 0 ? (
          <EmptyState
            size="sm"
            title="No milestones yet"
            description={
              canManage
                ? 'Break the work into stages — for example site inspection, repair, final inspection.'
                : 'The assigned organisation has not added milestones yet.'
            }
          />
        ) : (
          <ol className="space-y-4">
            {milestones.map((milestone, index) => (
              <li
                key={milestone.id}
                id={`milestone-${milestone.id}`}
                className="scroll-mt-24 rounded-control border border-border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="type-caption text-ink-subtle">Milestone {index + 1}</p>
                    <h3 className="type-body-sm font-semibold text-ink">
                      {milestone.title}
                    </h3>
                  </div>
                  <MilestoneStatusBadge status={milestone.status} />
                </div>
                {milestone.description && (
                  <p className="mt-1 type-caption text-ink-muted">
                    {milestone.description}
                  </p>
                )}
                <p className="mt-2 flex items-center gap-1.5 type-caption text-ink-muted">
                  <CalendarDays className="size-3" aria-hidden="true" />
                  {milestone.dueDate
                    ? `Due ${formatDay(milestone.dueDate)}`
                    : 'No due date'}
                  {' · '}
                  {milestone.tasks.completed} /{' '}
                  {milestone.tasks.total - milestone.tasks.cancelled} tasks done
                </p>
                <ProgressBar
                  className="mt-2"
                  size="sm"
                  value={milestone.progress}
                  label={`${milestone.title}: ${milestone.progress}% of tasks done`}
                />
                {canManage && (
                  <div className="mt-3">
                    {milestone.completedAt ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        leadingIcon={<RotateCcw />}
                        loading={busy === milestone.id}
                        onClick={async () => {
                          setBusy(milestone.id);
                          await onToggle(milestone, false).finally(() => setBusy(null));
                        }}
                      >
                        Reopen
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        leadingIcon={<CheckCircle2 />}
                        loading={busy === milestone.id}
                        disabled={milestone.tasks.open > 0}
                        title={
                          milestone.tasks.open > 0
                            ? 'Finish or cancel its open tasks first.'
                            : undefined
                        }
                        onClick={async () => {
                          setBusy(milestone.id);
                          await onToggle(milestone, true).finally(() => setBusy(null));
                        }}
                      >
                        Mark completed
                      </Button>
                    )}
                    {!milestone.completedAt && milestone.tasks.open > 0 && (
                      <p className="mt-1 type-caption text-ink-subtle">
                        {milestone.tasks.open} open{' '}
                        {milestone.tasks.open === 1 ? 'task' : 'tasks'} left.
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardBody>

      <Modal open={creating} onOpenChange={(value) => !value && setCreating(false)}>
        {creating && (
          <MilestoneForm
            minDate={minDate}
            onClose={() => setCreating(false)}
            onCreate={onCreate}
          />
        )}
      </Modal>
    </Card>
  );
}

function MilestoneForm({
  minDate,
  onClose,
  onCreate,
}: {
  minDate: string | null;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    description: string | null;
    dueDate: string | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!title.trim()) {
      setError('Give the milestone a title.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        dueDate: dueDate || null,
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not add the milestone.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalContent
      size="md"
      title="Add milestone"
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
            onClick={() => void submit()}
          >
            Add milestone
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input
            value={title}
            maxLength={TASK_TITLE_MAX_LENGTH}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Due date">
          <Input
            type="date"
            value={dueDate}
            min={minDate ?? undefined}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="type-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </ModalContent>
  );
}
