import { BadgeCheck, Building2 } from 'lucide-react';
import Link from 'next/link';
import type { ProblemAssignment } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { formatDate } from '@/lib/format';
import { ORGANIZATION_TYPE_LABEL } from '@/lib/workspace';

/**
 * On a public problem page once a government office's allocation was
 * accepted. Who is on it and since when — no notes, reasons or history.
 */
export function ProblemAssignmentCard({ assignment }: { assignment: ProblemAssignment }) {
  const { organization } = assignment;
  return (
    <Card>
      <CardHeader
        title="Assigned organisation"
        icon={<Building2 className="size-4 text-primary" />}
      />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar
            name={organization.name}
            src={organization.logoUrl ?? undefined}
            size="md"
            className="rounded-control"
          />
          <div className="min-w-0">
            <Link
              href={`/organizations/${encodeURIComponent(organization.slug)}`}
              className="block truncate type-body-sm font-semibold text-ink underline-offset-2 hover:underline"
            >
              {organization.name}
            </Link>
            <p className="type-caption text-ink-subtle">
              {ORGANIZATION_TYPE_LABEL[organization.type]}
            </p>
          </div>
        </div>
        <p className="inline-flex items-center gap-1.5 type-caption font-medium text-success">
          <BadgeCheck className="size-3.5" aria-hidden="true" />
          Government-assigned
        </p>
        <p className="type-caption text-ink-muted">
          Assigned by the local government office on{' '}
          <time dateTime={assignment.assignedAt}>
            {formatDate(assignment.assignedAt)}
          </time>
          .
        </p>
        {assignment.progress !== undefined && assignment.progress !== null && (
          <ProgressBar
            value={assignment.progress}
            label="Work progress"
            showLabel
            size="sm"
          />
        )}
      </CardBody>
    </Card>
  );
}
