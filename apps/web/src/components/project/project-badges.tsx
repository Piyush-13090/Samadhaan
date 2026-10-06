import { AlertTriangle } from 'lucide-react';
import type {
  MilestoneStatus,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '@samadhaan/shared';
import { Badge, StatusDot } from '@/components/ui/badge';
import {
  MILESTONE_STATUS_DISPLAY,
  PROJECT_STATUS_DISPLAY,
  TASK_PRIORITY_DISPLAY,
  TASK_STATUS_DISPLAY,
} from '@/lib/project';

/** Status is always a word; the dot only repeats it. */
export function ProjectStatusBadge({
  status,
  size = 'md',
}: {
  status: ProjectStatus;
  size?: 'sm' | 'md';
}) {
  const d = PROJECT_STATUS_DISPLAY[status];
  return (
    <Badge tone={d.tone} size={size} icon={<StatusDot tone={d.tone} />}>
      {d.label}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const d = TASK_STATUS_DISPLAY[status];
  return (
    <Badge tone={d.tone} size="sm" icon={<StatusDot tone={d.tone} />}>
      {d.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const d = TASK_PRIORITY_DISPLAY[priority];
  return (
    <Badge tone={d.tone} size="sm">
      <span className="sr-only">Priority: </span>
      {d.label}
    </Badge>
  );
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  const d = MILESTONE_STATUS_DISPLAY[status];
  return (
    <Badge tone={d.tone} size="sm" icon={<StatusDot tone={d.tone} />}>
      {d.label}
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge tone="danger" size="sm" icon={<AlertTriangle />}>
      Overdue
    </Badge>
  );
}
