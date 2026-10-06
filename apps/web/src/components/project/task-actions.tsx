'use client';

import { Ban, CheckCircle2, OctagonPause, Pencil, PlayCircle } from 'lucide-react';
import type { TaskStatus, TaskView } from '@samadhaan/shared';
import { Button } from '@/components/ui/button';
import { TASK_ACTION_LABEL } from '@/lib/project';

const ICON: Partial<Record<TaskStatus, typeof PlayCircle>> = {
  IN_PROGRESS: PlayCircle,
  BLOCKED: OctagonPause,
  COMPLETED: CheckCircle2,
  CANCELLED: Ban,
};

/**
 * The moves the API said this viewer may make — and only those. Plain
 * buttons, so changing status never depends on dragging.
 */
export function TaskActions({
  task,
  busy,
  onMove,
  onEdit,
}: {
  task: TaskView;
  busy: boolean;
  onMove: (task: TaskView, to: TaskStatus) => void;
  onEdit?: (task: TaskView) => void;
}) {
  if (task.allowedTransitions.length === 0 && !task.canEdit) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label={`Actions for ${task.title}`}
    >
      {task.allowedTransitions.map((to) => {
        const Icon = ICON[to] ?? PlayCircle;
        const label =
          to === 'IN_PROGRESS' && task.status === 'BLOCKED'
            ? 'Unblock'
            : TASK_ACTION_LABEL[to];
        return (
          <Button
            key={to}
            size="sm"
            variant={to === 'COMPLETED' ? 'primary' : 'secondary'}
            leadingIcon={<Icon />}
            disabled={busy}
            onClick={() => onMove(task, to)}
            aria-label={`${label}: ${task.title}`}
          >
            {label}
          </Button>
        );
      })}
      {task.canEdit && onEdit && (
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Pencil />}
          disabled={busy}
          onClick={() => onEdit(task)}
          aria-label={`Edit: ${task.title}`}
        >
          Edit
        </Button>
      )}
    </div>
  );
}
