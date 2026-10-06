'use client';

import { useState } from 'react';
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_TITLE_MAX_LENGTH,
  type MilestoneView,
  type ProjectAssignee,
  type TaskPriority,
  type TaskView,
} from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { TASK_PRIORITY_DISPLAY } from '@/lib/project';
import type { TaskInput } from '@/services/project.service';
import { NativeSelect } from './native-select';

/**
 * Create or edit a task. Assignees are the assigned organisation's active
 * members, as the API lists them — and the API checks again.
 */
export function TaskDialog({
  open,
  task,
  assignees,
  milestones,
  minDate,
  onClose,
  onSave,
}: {
  open: boolean;
  /** Null to create. */
  task: TaskView | null;
  assignees: ProjectAssignee[];
  milestones: MilestoneView[];
  /** The project's start date: tasks cannot be due before it. */
  minDate: string | null;
  onClose: () => void;
  onSave: (input: TaskInput, task: TaskView | null) => Promise<void>;
}) {
  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()}>
      {open && (
        <TaskForm
          key={task?.id ?? 'new'}
          task={task}
          assignees={assignees}
          milestones={milestones}
          minDate={minDate}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Modal>
  );
}

function TaskForm({
  task,
  assignees,
  milestones,
  minDate,
  onClose,
  onSave,
}: Omit<Parameters<typeof TaskDialog>[0], 'open'>) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM');
  const [assignee, setAssignee] = useState(task?.assignee?.userId ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [milestone, setMilestone] = useState(task?.milestone?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const openMilestones = milestones.filter(
    (m) => !m.completedAt || m.id === task?.milestone?.id,
  );

  async function submit() {
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (dueDate && minDate && dueDate < minDate) {
      setError(`The due date cannot be before the project starts (${minDate}).`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSave(
        {
          title: title.trim(),
          description: description.trim() || null,
          priority,
          assignedToId: assignee || null,
          dueDate: dueDate || null,
          milestoneId: milestone || null,
        },
        task,
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the task.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalContent
      size="md"
      title={task ? 'Edit task' : 'Create task'}
      description="Tasks are written by people. Progress is counted from them."
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
            {task ? 'Save task' : 'Create task'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Task title" required>
          <Input
            value={title}
            maxLength={TASK_TITLE_MAX_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Description">
          <Textarea
            rows={3}
            value={description}
            maxLength={TASK_DESCRIPTION_MAX_LENGTH}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assignee" hint="Active members of the assigned organisation.">
            <NativeSelect
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">Unassigned</option>
              {assignees.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              value={dueDate}
              min={minDate ?? undefined}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Field label="Priority">
            <NativeSelect
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {TASK_PRIORITY_DISPLAY[value].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Milestone">
            <NativeSelect
              value={milestone}
              onChange={(event) => setMilestone(event.target.value)}
            >
              <option value="">None</option>
              {openMilestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {error && (
          <p role="alert" className="type-body-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          Save
        </button>
      </form>
    </ModalContent>
  );
}
