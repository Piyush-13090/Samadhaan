'use client';

import {
  AlertTriangle,
  CalendarClock,
  Info,
  Lightbulb,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
  CoordinatorBlocker,
  CoordinatorRisk,
  CoordinatorView,
} from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { HEALTH_DISPLAY, SEVERITY_DISPLAY } from '@/lib/coordinator';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { fetchCoordinator, refreshInsights } from '@/services/coordinator.service';
import { CoordinatorQuestions } from './coordinator-questions';
import { SourceLinks } from './source-links';

/**
 * The AI Project Coordinator card.
 *
 * Two layers, labelled as such. **Health** is computed from the project's data
 * on every load and is always current. The **AI interpretation** — summary,
 * suggestions, potential blockers, questions — was generated at a stated time
 * by a stated model, and says so when it may be outdated. Every finding links
 * to the task, message or event it rests on. The coordinator advises; it
 * changes nothing in the project.
 */
export function AIProjectCoordinator({
  projectId,
  canDismiss,
  /** Bumped by the page after a task or milestone change, to refresh health. */
  reloadKey,
}: {
  projectId: string;
  canDismiss: boolean;
  reloadKey: number;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<CoordinatorView | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      fetchCoordinator(projectId)
        .then((next) => {
          setView(next);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [projectId],
  );
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function refresh() {
    setRefreshing(true);
    try {
      setView(await refreshInsights(projectId));
      toast({ tone: 'success', title: 'AI insights refreshed' });
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'Insights not refreshed',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
      void load();
    } finally {
      setRefreshing(false);
    }
  }

  if (failed && !view) {
    return (
      <Card id="coordinator">
        <ErrorState
          size="sm"
          title="The coordinator could not be loaded"
          onRetry={() => void load()}
        />
      </Card>
    );
  }
  if (!view) {
    return (
      <Card id="coordinator" aria-busy="true">
        <CardBody>
          <p className="type-body-sm text-ink-muted">Loading the project coordinator…</p>
        </CardBody>
      </Card>
    );
  }

  const health = HEALTH_DISPLAY[view.health.level];
  const insight = view.insight;
  const risks: CoordinatorRisk[] = [...view.risks, ...(insight?.risks ?? [])];
  const blockers: CoordinatorBlocker[] = [...view.blockers, ...(insight?.blockers ?? [])];
  const cooling =
    view.refreshAvailableAt !== null && new Date(view.refreshAvailableAt) > new Date();

  return (
    <Card id="coordinator" className="scroll-mt-24 border-ai-border">
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 type-h4 text-ink">
              <AiSparkIcon className="size-4 text-ai" />
              AI Project Coordinator
            </h2>
            <p className="type-caption text-ink-subtle">
              Advisory. People decide and act; nothing here changes the project.
            </p>
          </div>
          {view.canRefresh && (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<RefreshCw />}
              loading={refreshing}
              disabled={cooling}
              title={
                cooling
                  ? `Available again ${formatRelativeTime(view.refreshAvailableAt!)}`
                  : undefined
              }
              onClick={() => void refresh()}
            >
              Refresh insights
            </Button>
          )}
        </div>

        {/* Health: deterministic and current. */}
        <section aria-labelledby="coordinator-health">
          <h3 id="coordinator-health" className="sr-only">
            Project health
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={health.tone} icon={<StatusDot tone={health.tone} />}>
              {health.label}
            </Badge>
            <span className="type-caption text-ink-subtle">
              Computed from current project data
            </span>
          </div>
          {view.health.reasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 type-body-sm text-ink">
              {view.health.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 type-body-sm text-ink-muted">{health.description}</p>
          )}
        </section>

        {/* The AI interpretation: cached, attributed, dated. */}
        {insight ? (
          <section
            aria-labelledby="coordinator-summary"
            className="rounded-control bg-ai-soft/40 p-3"
          >
            <h3
              id="coordinator-summary"
              className="flex items-center gap-1.5 type-label text-ai"
            >
              <AiSparkIcon /> Summary
            </h3>
            <p className="mt-1 type-body-sm text-ink">{insight.summary}</p>
            <p className="mt-2 type-caption text-ink-subtle">
              <time
                dateTime={insight.generatedAt}
                title={formatDateTime(insight.generatedAt)}
              >
                Updated {formatRelativeTime(insight.generatedAt)}
              </time>{' '}
              · {insight.model.name} ({insight.model.provider}) · prompt{' '}
              {insight.model.promptVersion}
            </p>
            {insight.stale && (
              <p
                role="status"
                className="mt-2 flex items-start gap-1.5 type-caption font-medium text-warning"
              >
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                AI insights may be outdated — the project has changed since. Refresh to
                update them.
              </p>
            )}
          </section>
        ) : (
          <p className="rounded-control bg-subtle/60 p-3 type-body-sm text-ink-muted">
            No AI insights yet.{' '}
            {view.canRefresh ? 'Refresh to generate a summary and questions.' : ''}
          </p>
        )}
        {view.lastFailure && (
          <p role="alert" className="flex items-start gap-1.5 type-caption text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            The last attempt ({formatRelativeTime(view.lastFailure.at)}) failed:{' '}
            {view.lastFailure.message}
            {insight ? ' The insights above are from the previous run.' : ''}
          </p>
        )}

        {blockers.length > 0 && (
          <section aria-labelledby="coordinator-blockers">
            <h3
              id="coordinator-blockers"
              className="flex items-center gap-1.5 type-label text-ink"
            >
              <ShieldAlert className="size-4 text-danger" aria-hidden="true" /> Blockers
            </h3>
            <ul className="mt-2 space-y-2">
              {blockers.map((blocker, index) => (
                <li key={`${blocker.origin}-${index}`} className="type-body-sm">
                  <p className="flex flex-wrap items-center gap-1.5 text-ink">
                    {blocker.title}
                    {blocker.origin === 'AI' && (
                      <Badge tone="ai" size="sm" icon={<AiSparkIcon />}>
                        AI-detected potential blocker — unconfirmed
                      </Badge>
                    )}
                  </p>
                  {blocker.origin === 'AI' && (
                    <p className="type-caption text-ink-muted">{blocker.description}</p>
                  )}
                  <SourceLinks sources={blocker.sources} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {risks.length > 0 && (
          <section aria-labelledby="coordinator-risks">
            <h3
              id="coordinator-risks"
              className="flex items-center gap-1.5 type-label text-ink"
            >
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" /> Risks
            </h3>
            <ul className="mt-2 space-y-2">
              {risks.map((risk, index) => (
                <li key={`${risk.origin}-${index}`} className="type-body-sm">
                  <p className="flex flex-wrap items-center gap-1.5 text-ink">
                    <Badge tone={SEVERITY_DISPLAY[risk.severity].tone} size="sm">
                      <span className="sr-only">Severity: </span>
                      {SEVERITY_DISPLAY[risk.severity].label}
                    </Badge>
                    {risk.title}
                    {risk.origin === 'AI' && (
                      <Badge tone="ai" size="sm" icon={<AiSparkIcon />}>
                        AI
                      </Badge>
                    )}
                  </p>
                  <SourceLinks sources={risk.sources} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {insight && insight.suggestions.length > 0 && (
          <section aria-labelledby="coordinator-suggestions">
            <h3
              id="coordinator-suggestions"
              className="flex items-center gap-1.5 type-label text-ink"
            >
              <Lightbulb className="size-4 text-ai" aria-hidden="true" /> Suggested next
              steps
            </h3>
            <ul className="mt-2 space-y-2">
              {insight.suggestions.map((suggestion, index) => (
                <li key={index} className="type-body-sm text-ink">
                  {suggestion.text}
                  <SourceLinks sources={suggestion.sources} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.deadlines.length > 0 && (
          <section aria-labelledby="coordinator-deadlines">
            <h3
              id="coordinator-deadlines"
              className="flex items-center gap-1.5 type-label text-ink"
            >
              <CalendarClock className="size-4 text-ink-subtle" aria-hidden="true" />{' '}
              Upcoming deadlines
            </h3>
            <ul className="mt-2 space-y-1 type-body-sm text-ink">
              {view.deadlines.map((deadline, index) => (
                <li key={index}>
                  {deadline.source?.href ? (
                    <a
                      href={deadline.source.href}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {deadline.title}
                    </a>
                  ) : (
                    deadline.title
                  )}{' '}
                  —{' '}
                  {deadline.daysLeft === 0
                    ? 'due today'
                    : `due in ${deadline.daysLeft} day${deadline.daysLeft === 1 ? '' : 's'}`}
                </li>
              ))}
            </ul>
          </section>
        )}

        <CoordinatorQuestions
          projectId={projectId}
          questions={view.questions}
          canAnswer={view.canAnswer}
          canDismiss={canDismiss}
          onChange={setView}
        />
      </CardBody>
    </Card>
  );
}
