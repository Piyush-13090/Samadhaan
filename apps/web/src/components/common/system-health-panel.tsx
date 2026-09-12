import type { DependencyHealth } from '@samadhaan/shared';
import type { HealthQueryResult } from '@/services/health.service';
import { HEALTH_LABEL, HEALTH_TONE } from '@/types/ui';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

/** Human-readable names for the dependency keys the API reports. */
const DEPENDENCY_LABELS: Record<string, string> = {
  database: 'PostgreSQL',
  redis: 'Redis',
  aiService: 'AI service',
};

function DependencyRow({ dependency }: { dependency: DependencyHealth }) {
  const tone = HEALTH_TONE[dependency.status];

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {DEPENDENCY_LABELS[dependency.name] ?? dependency.name}
        </p>
        {dependency.message && (
          <p className="mt-0.5 truncate text-xs text-ink-subtle">{dependency.message}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {dependency.latencyMs !== null && (
          <span className="font-mono text-xs text-ink-subtle">
            {dependency.latencyMs} ms
          </span>
        )}
        <Badge tone={tone}>
          <StatusDot tone={tone} />
          {HEALTH_LABEL[dependency.status]}
        </Badge>
      </div>
    </li>
  );
}

/**
 * Renders live system health.
 *
 * This is the placeholder application's proof that the whole chain works:
 * the browser calls Next.js, Next.js calls the NestJS API, and the API reports
 * on PostgreSQL, Redis and the Python AI service. Nothing here is mock data.
 */
export function SystemHealthPanel({ result }: { result: HealthQueryResult }) {
  if (!result.reachable) {
    return (
      <Card>
        <CardHeader title="System status" />
        <CardBody>
          <Alert tone="danger" title="The Samadhaan API is unreachable">
            {result.message}. Start the infrastructure with{' '}
            <code className="font-mono text-xs">docker compose up -d</code>, then run{' '}
            <code className="font-mono text-xs">npm run dev:api</code>.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  const { report } = result;
  const overallTone = HEALTH_TONE[report.status];

  return (
    <Card>
      <CardHeader
        title="System status"
        description={`${report.service} v${report.version} · ${report.environment} · up ${report.uptimeSeconds}s`}
        action={
          <Badge tone={overallTone}>
            <StatusDot tone={overallTone} />
            {HEALTH_LABEL[report.status]}
          </Badge>
        }
      />
      <CardBody className="py-1">
        <ul className="divide-y divide-border">
          {report.dependencies.map((dependency) => (
            <DependencyRow key={dependency.name} dependency={dependency} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
