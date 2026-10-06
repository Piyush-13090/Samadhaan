'use client';

import { BookOpen, Plus, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type {
  KnowledgeAuthoring,
  KnowledgeSourcePage,
  KnowledgeSourceView,
} from '@samadhaan/shared';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { formatRelativeTime } from '@/lib/format';
import { SOURCE_TYPE_LABEL, STATUS_DISPLAY, VISIBILITY_DISPLAY } from '@/lib/knowledge';
import {
  fetchAuthoring,
  fetchSources,
  reindexSource,
} from '@/services/knowledge.service';
import { AskKnowledge } from './ask-knowledge';
import { SourceDialog } from './source-dialog';

/**
 * The knowledge library: ask a question, browse the sources you may read, and
 * manage the ones you own. Sources still indexing refresh themselves.
 */
export function KnowledgeLibrary() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<KnowledgeSourcePage | null>(null);
  const [failed, setFailed] = useState(false);
  const [authoring, setAuthoring] = useState<KnowledgeAuthoring | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      fetchSources({ page, q: search, manageable: mine })
        .then((next) => {
          setData(next);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [page, search, mine],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void fetchAuthoring()
      .then(setAuthoring)
      .catch(() => setAuthoring(null));
  }, []);

  // Poll while anything is queued or indexing.
  const busy = data?.items.some(
    (s) => s.status === 'PENDING' || s.status === 'PROCESSING',
  );
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  async function retry(source: KnowledgeSourceView) {
    try {
      await reindexSource(source.id);
      toast({ tone: 'success', title: 'Indexing again' });
      void load();
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'Could not start indexing',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0">
        <AskKnowledge />
      </div>

      <Card className="min-w-0">
        <CardHeader
          title="Sources"
          description="Only sources you are allowed to read are listed."
          action={
            <Button size="sm" leadingIcon={<Plus />} onClick={() => setAdding(true)}>
              Add knowledge
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(q.trim());
            }}
          >
            <Input
              aria-label="Search sources by title"
              className="min-w-0 flex-1"
              leadingIcon={<Search />}
              value={q}
              placeholder="Search titles"
              onChange={(event) => setQ(event.target.value)}
            />
            <label className="flex items-center gap-1.5 type-body-sm text-ink-muted">
              <input
                type="checkbox"
                checked={mine}
                onChange={(event) => {
                  setPage(1);
                  setMine(event.target.checked);
                }}
              />
              Ones I manage
            </label>
          </form>

          {failed && !data ? (
            <ErrorState
              size="sm"
              title="Sources could not be loaded"
              onRetry={() => void load()}
            />
          ) : !data ? (
            <p className="type-body-sm text-ink-muted">Loading sources…</p>
          ) : data.items.length === 0 ? (
            <EmptyState
              size="sm"
              icon={BookOpen}
              title="No sources yet"
              description="Add a guideline, policy or project document to make it searchable."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.items.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onRetry={() => void retry(source)}
                />
              ))}
            </ul>
          )}
          {data && data.totalPages > 1 && (
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </CardBody>
      </Card>

      <SourceDialog
        open={adding}
        authoring={authoring}
        onClose={() => setAdding(false)}
        onCreated={() => {
          toast({ tone: 'success', title: 'Source added — indexing in the background' });
          void load();
        }}
      />
    </div>
  );
}

function SourceRow({
  source,
  onRetry,
}: {
  source: KnowledgeSourceView;
  onRetry: () => void;
}) {
  const status = STATUS_DISPLAY[source.status];
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/knowledge/sources/${source.id}`}
            className="type-body-sm font-medium text-ink hover:text-primary hover:underline"
          >
            {source.title}
          </Link>
          <p className="type-caption text-ink-subtle">
            {SOURCE_TYPE_LABEL[source.sourceType]} ·{' '}
            {VISIBILITY_DISPLAY[source.visibility].label}
            {source.organization ? ` · ${source.organization.name}` : ''}
            {source.project ? ` · ${source.project.name}` : ''}
            {source.status === 'COMPLETED'
              ? ` · ${source.chunkCount} passage${source.chunkCount === 1 ? '' : 's'}`
              : ''}{' '}
            · updated {formatRelativeTime(source.updatedAt)}
          </p>
          {source.status === 'FAILED' && source.failureMessage && (
            <p className="type-caption text-danger">{source.failureMessage}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge size="sm" tone={status.tone} icon={<StatusDot tone={status.tone} />}>
            {status.label}
          </Badge>
          {source.status === 'FAILED' && source.permissions.canIngest && (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<RefreshCw />}
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
