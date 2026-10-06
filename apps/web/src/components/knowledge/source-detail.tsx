'use client';

import { ExternalLink, FileText, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeChunkView, KnowledgeSourceView } from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { ErrorState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { formatDateTime } from '@/lib/format';
import {
  SOURCE_TYPE_LABEL,
  STATUS_DISPLAY,
  VISIBILITY_DISPLAY,
  formatBytes,
} from '@/lib/knowledge';
import {
  deleteSource,
  fetchChunks,
  fetchSource,
  reindexSource,
} from '@/services/knowledge.service';

/**
 * One source: who can read it, its indexing state, and every passage as
 * retrieved — each with a `#chunk-{id}` anchor, which is where citations land.
 */
export function SourceDetail({ initial }: { initial: KnowledgeSourceView }) {
  const router = useRouter();
  const { toast } = useToast();
  const [source, setSource] = useState(initial);
  const [chunks, setChunks] = useState<KnowledgeChunkView[] | null>(null);
  const [chunksFailed, setChunksFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  const loadChunks = useCallback(
    () =>
      fetchChunks(source.id)
        .then((next) => {
          setChunks(next);
          setChunksFailed(false);
          // A citation lands here as #chunk-{id}: highlight that passage.
          const hash = window.location.hash.slice(1);
          setTarget(hash.startsWith('chunk-') ? hash : null);
        })
        .catch(() => setChunksFailed(true)),
    [source.id],
  );
  useEffect(() => {
    void loadChunks();
  }, [loadChunks, source.ingestedAt]);

  // Follow indexing until it settles.
  const busy = source.status === 'PENDING' || source.status === 'PROCESSING';
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(
      () =>
        void fetchSource(source.id)
          .then(setSource)
          .catch(() => undefined),
      3000,
    );
    return () => window.clearInterval(timer);
  }, [busy, source.id]);

  // Scroll the cited passage into view once it is on screen.
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'center' });
  }, [target]);

  async function reindex() {
    try {
      setSource(await reindexSource(source.id));
      toast({ tone: 'success', title: 'Indexing again' });
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'Could not start indexing',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deleteSource(source.id);
      toast({ tone: 'success', title: 'Source deleted' });
      router.push('/knowledge');
    } catch (caught) {
      toast({
        tone: 'danger',
        title: 'Could not delete the source',
        description: caught instanceof ApiError ? caught.message : undefined,
      });
      setDeleting(false);
    }
  }

  const status = STATUS_DISPLAY[source.status];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <div>
          <Link href="/knowledge" className="type-body-sm text-primary hover:underline">
            ← Knowledge
          </Link>
          <h1 className="mt-2 type-h2 text-ink">{source.title}</h1>
          {source.description && (
            <p className="mt-1 type-body text-ink-muted">{source.description}</p>
          )}
        </div>
        {source.status === 'FAILED' && (
          <Alert tone="danger" title="Indexing failed">
            {source.failureMessage}
          </Alert>
        )}
        <Card>
          <CardHeader
            title="Passages"
            description="The text exactly as it is retrieved and cited."
          />
          <CardBody>
            {chunksFailed ? (
              <ErrorState
                size="sm"
                title="Passages could not be loaded"
                onRetry={() => void loadChunks()}
              />
            ) : !chunks ? (
              <p className="type-body-sm text-ink-muted">Loading passages…</p>
            ) : chunks.length === 0 ? (
              <p className="type-body-sm text-ink-muted">
                {busy
                  ? 'Indexing — passages appear when it finishes.'
                  : 'No passages indexed.'}
              </p>
            ) : (
              <ol className="space-y-3">
                {chunks.map((chunk) => (
                  <li
                    key={chunk.id}
                    id={`chunk-${chunk.id}`}
                    className={cn(
                      'scroll-mt-24 rounded-control border p-3',
                      target === `chunk-${chunk.id}`
                        ? 'border-primary bg-primary-soft/40'
                        : 'border-border-subtle',
                    )}
                  >
                    <p className="type-caption text-ink-subtle">
                      Passage {chunk.chunkIndex + 1}
                      {chunk.sectionTitle ? ` · ${chunk.sectionTitle}` : ''}
                      {chunk.pageNumber ? ` · page ${chunk.pageNumber}` : ''}
                      {target === `chunk-${chunk.id}` ? ' · cited' : ''}
                    </p>
                    <p className="mt-1 type-body-sm whitespace-pre-line text-ink">
                      {chunk.content}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card>
          <CardBody className="space-y-3">
            <Badge tone={status.tone} icon={<StatusDot tone={status.tone} />}>
              {status.label}
            </Badge>
            <dl className="grid gap-2 type-body-sm">
              <Meta label="Who can read it">
                {VISIBILITY_DISPLAY[source.visibility].label} —{' '}
                {VISIBILITY_DISPLAY[source.visibility].description}
              </Meta>
              <Meta label="Type">{SOURCE_TYPE_LABEL[source.sourceType]}</Meta>
              {source.organization && (
                <Meta label="Owner">{source.organization.name}</Meta>
              )}
              {source.project && (
                <Meta label="Project">
                  <Link
                    href={`/resolution/${source.project.roomId}/project`}
                    className="text-primary hover:underline"
                  >
                    {source.project.name}
                  </Link>
                </Meta>
              )}
              {source.uploadedBy && (
                <Meta label="Added by">{source.uploadedBy.name}</Meta>
              )}
              {source.categories.length > 0 && (
                <Meta label="Categories">
                  {source.categories.map((c) => CATEGORY_DISPLAY[c].label).join(', ')}
                </Meta>
              )}
              {source.city && <Meta label="City">{source.city}</Meta>}
              <Meta label="Passages">{source.chunkCount}</Meta>
              {source.ingestedAt && (
                <Meta label="Indexed">{formatDateTime(source.ingestedAt)}</Meta>
              )}
              {source.embeddingModel && (
                <Meta label="Embedding">
                  {source.embeddingModel} ({source.embeddingVersion}) · chunker{' '}
                  {source.chunkerVersion}
                </Meta>
              )}
            </dl>
            {source.file && (
              <a
                href={source.file.url}
                className="flex items-center gap-1.5 type-body-sm text-primary hover:underline"
              >
                <FileText className="size-4" aria-hidden="true" />
                {source.file.name} ({formatBytes(source.file.sizeBytes)})
              </a>
            )}
            {source.externalUrl && (
              <a
                href={source.externalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center gap-1.5 type-body-sm text-primary hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Original link
              </a>
            )}
            {(source.permissions.canIngest || source.permissions.canDelete) && (
              <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-3">
                {source.permissions.canIngest && (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<RefreshCw />}
                    disabled={busy}
                    onClick={() => void reindex()}
                  >
                    {source.status === 'FAILED' ? 'Retry' : 'Re-index'}
                  </Button>
                )}
                {source.permissions.canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Trash2 />}
                    onClick={() => setConfirming(true)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </aside>

      <Modal open={confirming} onOpenChange={setConfirming}>
        <ModalContent
          size="sm"
          title="Delete this source?"
          description="Its passages stop appearing in answers immediately. This cannot be undone."
          footer={
            <>
              <ModalClose asChild>
                <Button variant="secondary" size="sm">
                  Cancel
                </Button>
              </ModalClose>
              <Button
                variant="danger"
                size="sm"
                loading={deleting}
                onClick={() => void remove()}
              >
                Delete
              </Button>
            </>
          }
        >
          <span />
        </ModalContent>
      </Modal>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="type-caption text-ink-subtle">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
