import type { TaskStatus, TaskView } from '@samadhaan/shared';
import { formatRelativeTime } from '@/lib/format';
import { formatDay } from '@/lib/project';
import { OverdueBadge, PriorityBadge, TaskStatusBadge } from './project-badges';
import { TaskActions } from './task-actions';

/** The same tasks as a table — the accessible, phone-friendly alternative. */
export function TaskTable({
  tasks,
  busyId,
  onMove,
  onEdit,
}: {
  tasks: TaskView[];
  busyId: string | null;
  onMove: (task: TaskView, to: TaskStatus) => void;
  onEdit: (task: TaskView) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[44rem] text-left type-body-sm">
        <caption className="sr-only">Project tasks</caption>
        <thead className="bg-subtle/60 type-caption text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Task
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Priority
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Assignee
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Due date
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Updated
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {tasks.map((task) => (
            <tr key={task.id} className="align-top">
              <th scope="row" className="px-3 py-2.5 font-medium text-ink">
                {task.title}
                {task.milestone && (
                  <span className="block type-caption font-normal text-ink-subtle">
                    {task.milestone.title}
                  </span>
                )}
              </th>
              <td className="px-3 py-2.5">
                <TaskStatusBadge status={task.status} />
              </td>
              <td className="px-3 py-2.5">
                <PriorityBadge priority={task.priority} />
              </td>
              <td className="px-3 py-2.5 text-ink">
                {task.assignee?.name ?? 'Unassigned'}
              </td>
              <td className="px-3 py-2.5">
                <span className="block text-ink">{formatDay(task.dueDate)}</span>
                {task.overdue && <OverdueBadge />}
              </td>
              <td className="px-3 py-2.5 type-caption text-ink-muted">
                {formatRelativeTime(task.updatedAt)}
              </td>
              <td className="px-3 py-2.5">
                <TaskActions
                  task={task}
                  busy={busyId === task.id}
                  onMove={onMove}
                  onEdit={onEdit}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
