import { AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ProjectSummary } from '@samadhaan/shared';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatDay, projectPath } from '@/lib/project';
import { ProjectStatusBadge } from './project-badges';

/** A live project on a dashboard, from real counts. */
export function ProjectCard({
  project,
  partner,
}: {
  project: ProjectSummary;
  /** Which side's name to show: the office for an organisation, and vice versa. */
  partner: 'government' | 'organization';
}) {
  const { overview } = project;
  const counted = overview.tasks.total - overview.tasks.cancelled;
  return (
    <Card as="article" className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono type-caption text-ink-subtle">
          {project.problemPublicId}
        </span>
        <ProjectStatusBadge status={project.status} size="sm" />
      </div>
      <h3 className="type-body-sm font-semibold text-ink">{project.name}</h3>
      <p className="type-caption text-ink-muted">
        {partner === 'government' ? project.government.name : project.organization.name}
        {project.targetDate && ` · Target ${formatDay(project.targetDate)}`}
      </p>
      <ProgressBar
        value={overview.taskProgress}
        size="sm"
        label={`${overview.taskProgress}% complete`}
      />
      <p className="flex flex-wrap items-center gap-x-3 type-caption text-ink-muted">
        <span className="tabular font-medium text-ink">
          {overview.taskProgress}% complete
        </span>
        <span>
          {overview.tasks.completed} / {counted} tasks
        </span>
        {overview.tasks.overdue > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-danger">
            <AlertTriangle className="size-3" aria-hidden="true" />
            {overview.tasks.overdue} overdue
          </span>
        )}
      </p>
      <Link
        href={projectPath(project.roomId)}
        className="mt-auto inline-flex items-center gap-1 self-start type-body-sm font-medium text-primary underline-offset-2 hover:underline"
      >
        Open project<span className="sr-only">: {project.name}</span>
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </Card>
  );
}
