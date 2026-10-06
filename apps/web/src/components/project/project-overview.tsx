import type { ProjectView } from '@samadhaan/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatDay } from '@/lib/project';
import { ProjectStatusBadge } from './project-badges';

/**
 * Every number here is counted by the API from the project's tasks and
 * milestones. Nobody types a percentage.
 */
export function ProjectOverview({ project }: { project: ProjectView }) {
  const { overview } = project;
  const counted = overview.tasks.total - overview.tasks.cancelled;
  return (
    <Card>
      <CardHeader title="Project overview" />
      <CardBody className="space-y-5">
        <ProgressBar
          value={overview.taskProgress}
          label={`Task progress: ${overview.taskProgress}% (${overview.tasks.completed} of ${counted} tasks completed)`}
          showLabel
          tone={overview.tasks.overdue > 0 ? 'warning' : 'primary'}
        />
        <dl className="grid grid-cols-2 gap-4 type-body-sm sm:grid-cols-3">
          <Metric label="Status">
            <ProjectStatusBadge status={project.status} size="sm" />
          </Metric>
          <Metric label="Progress">{overview.taskProgress}%</Metric>
          <Metric label="Tasks">
            {overview.tasks.completed} / {counted} completed
          </Metric>
          <Metric label="Milestones">
            {overview.milestones.completed} / {overview.milestones.total} completed
          </Metric>
          <Metric label="Overdue">
            <span
              className={
                overview.tasks.overdue > 0 ? 'font-semibold text-danger' : undefined
              }
            >
              {overview.tasks.overdue} {overview.tasks.overdue === 1 ? 'task' : 'tasks'}
            </span>
          </Metric>
          <Metric label="Target date">{formatDay(project.targetDate)}</Metric>
        </dl>
        <p className="type-caption text-ink-subtle">
          Progress counts completed tasks out of all tasks that are not cancelled.{' '}
          {overview.tasks.blocked > 0 && `${overview.tasks.blocked} blocked, `}
          {overview.tasks.inProgress} in progress, {overview.tasks.todo} to do.
        </p>
      </CardBody>
    </Card>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="type-caption text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 tabular text-ink">{children}</dd>
    </div>
  );
}
