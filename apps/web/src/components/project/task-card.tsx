import { CalendarDays, Flag, Paperclip } from 'lucide-react';
import type { TaskStatus, TaskView } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/project';
import { OverdueBadge, PriorityBadge } from './project-badges';
import { TaskActions } from './task-actions';

export function TaskCard({
  task,
  busy,
  onMove,
  onEdit,
}: {
  task: TaskView;
  busy: boolean;
  onMove: (task: TaskView, to: TaskStatus) => void;
  onEdit: (task: TaskView) => void;
}) {
  return (
    <article
      id={`task-${task.id}`}
      aria-label={task.title}
      className={cn(
        'scroll-mt-24 space-y-2.5 rounded-control border bg-surface p-3 shadow-card',
        task.overdue ? 'border-danger-border' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        {task.overdue && <OverdueBadge />}
      </div>
      <h4 className="type-body-sm font-semibold text-ink">{task.title}</h4>
      {task.description && (
        <p className="line-clamp-3 whitespace-pre-line type-caption text-ink-muted">
          {task.description}
        </p>
      )}
      <dl className="space-y-1 type-caption text-ink-muted">
        {task.milestone && (
          <div className="flex items-center gap-1.5">
            <Flag className="size-3" aria-hidden="true" />
            <dt className="sr-only">Milestone</dt>
            <dd>{task.milestone.title}</dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <CalendarDays className="size-3" aria-hidden="true" />
          <dt className="sr-only">Due</dt>
          <dd className={task.overdue ? 'font-medium text-danger' : undefined}>
            {task.dueDate ? `Due ${formatDay(task.dueDate)}` : 'No due date'}
          </dd>
        </div>
        {task.attachments.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Paperclip className="size-3" aria-hidden="true" />
            <dt className="sr-only">Files</dt>
            <dd>
              {task.attachments.map((a, index) => (
                <span key={a.id}>
                  {index > 0 && ', '}
                  <a
                    href={a.url}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {a.fileName}
                  </a>
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      <div className="flex items-center gap-2 type-caption text-ink">
        {task.assignee ? (
          <>
            <Avatar
              name={task.assignee.name}
              src={task.assignee.avatarUrl ?? undefined}
              size="xs"
            />
            <span>{task.assignee.name}</span>
          </>
        ) : (
          <span className="text-ink-subtle">Unassigned</span>
        )}
      </div>
      <TaskActions task={task} busy={busy} onMove={onMove} onEdit={onEdit} />
    </article>
  );
}
