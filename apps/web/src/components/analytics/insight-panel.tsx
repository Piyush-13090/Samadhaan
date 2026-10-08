'use client';

import { BookOpen, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AnalyticsInsightView } from '@samadhaan/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { type AnalyticsQuery } from '@/lib/analytics';
import { fetchLatestInsight, generateInsight } from '@/services/analytics.service';

/**
 * AI insights (Prompt 24): generated only when an official asks. Three
 * things are kept visibly apart — the observed figures, the AI's reading of
 * them (each statement names the figures it rests on), and reference
 * guidance from the knowledge base. Nothing here is a decision.
 */
export function InsightPanel({
  slug,
  query,
  queryKey,
}: {
  slug: string;
  query: AnalyticsQuery;
  queryKey: string;
}) {
  const [insight, setInsight] = useState<{
    key: string;
    view: AnalyticsInsightView | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchLatestInsight(slug, query, controller.signal)
      .then((r) => setInsight({ key: queryKey, view: r.insight }))
      .catch(() => {
        if (!controller.signal.aborted) setInsight({ key: queryKey, view: null });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, queryKey]);

  const view = insight?.key === queryKey ? insight.view : null;
  const factLabel = new Map(
    view?.facts.map((f) => [f.key, `${f.label}: ${f.value}`]) ?? [],
  );

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await generateInsight(slug, query);
      setInsight({ key: queryKey, view: result.insight });
    } catch {
      setError(
        'The summary could not be generated. The figures on this page are unaffected.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="AI summary"
        icon={<Sparkles className="size-4" aria-hidden="true" />}
        description="A plain-language reading of the figures below. It describes; it does not explain causes or decide anything."
        action={
          <Button variant="secondary" size="sm" onClick={generate} loading={busy}>
            {view ? 'Regenerate' : 'Generate summary'}
          </Button>
        }
      />
      <CardBody className="space-y-4" aria-live="polite">
        {error && <p className="type-body-sm text-danger">{error}</p>}
        {!view ? (
          <p className="type-body-sm text-ink-subtle">
            No summary for this period and these filters yet.
          </p>
        ) : (
          <>
            <section aria-label="AI interpretation" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ai" size="sm">
                  AI interpretation
                </Badge>
                {!view.model.aiRan && (
                  <Badge tone="neutral" size="sm">
                    No model ran — figures listed as recorded
                  </Badge>
                )}
              </div>
              <p className="type-body text-ink">{view.summary}</p>
              {[
                { title: 'Observations', items: view.observations },
                { title: 'May merit a closer look', items: view.attention },
              ].map(
                ({ title, items }) =>
                  items.length > 0 && (
                    <div key={title}>
                      <h3 className="type-body-sm font-medium text-ink">{title}</h3>
                      <ul className="mt-1 list-disc space-y-1 pl-5 type-body-sm text-ink-muted">
                        {items.map((item, i) => (
                          <li key={i}>
                            {item.text}{' '}
                            <span className="type-caption text-ink-subtle">
                              (based on{' '}
                              {item.metricKeys
                                .map((k) => factLabel.get(k) ?? k)
                                .join('; ')}
                              )
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </section>

            <details className="rounded-control border border-border p-3">
              <summary className="cursor-pointer type-body-sm font-medium text-ink">
                Observed data used ({view.facts.length} figures)
              </summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1 type-body-sm sm:grid-cols-2">
                {view.facts.map((fact) => (
                  <div key={fact.key} className="flex justify-between gap-3">
                    <dt className="text-ink-muted">{fact.label}</dt>
                    <dd className="tabular-nums text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </details>

            {view.guidance.length > 0 && (
              <section aria-label="Reference knowledge" className="space-y-2">
                <Badge
                  tone="info"
                  size="sm"
                  icon={<BookOpen className="size-3" aria-hidden="true" />}
                >
                  Reference knowledge
                </Badge>
                {view.guidanceNotes.map((note, i) => (
                  <p key={i} className="type-body-sm text-ink-muted">
                    {note.text}
                  </p>
                ))}
                <ul className="space-y-1 type-body-sm">
                  {view.guidance.map((g) => (
                    <li key={g.ref}>
                      <Link className="text-primary hover:underline" href={g.href}>
                        [{g.ref}] {g.title}
                        {g.sectionTitle ? ` — ${g.sectionTitle}` : ''}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="type-caption text-ink-subtle">
              Generated {new Date(view.generatedAt).toLocaleString()} · {view.model.name}{' '}
              · {view.model.promptVersion}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
