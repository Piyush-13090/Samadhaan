import type { TaskStatus, TaskView } from '@samadhaan/shared';
import { BOARD_COLUMNS, TASK_STATUS_DISPLAY } from '@/lib/project';
import { TaskCard } from './task-card';

/**
 * Columns by status. No drag and drop: each card's buttons move it, which
 * works from a keyboard and a screen reader. Stacked on phones.
 */
export function TaskBoard({
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
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {BOARD_COLUMNS.map((status) => {
        const column = tasks.filter((task) => task.status === status);
        return (
          <section
            key={status}
            aria-labelledby={`column-${status}`}
            className="rounded-card bg-subtle/60 p-3"
          >
            <h3
              id={`column-${status}`}
              className="mb-3 flex items-center justify-between type-label text-ink"
            >
              {TASK_STATUS_DISPLAY[status].label}
              <span className="tabular type-caption text-ink-subtle">
                {column.length}
                <span className="sr-only"> {column.length === 1 ? 'task' : 'tasks'}</span>
              </span>
            </h3>
            {column.length === 0 ? (
              <p className="type-caption text-ink-subtle">No tasks.</p>
            ) : (
              <ul className="space-y-2.5">
                {column.map((task) => (
                  <li key={task.id}>
                    <TaskCard
                      task={task}
                      busy={busyId === task.id}
                      onMove={onMove}
                      onEdit={onEdit}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
