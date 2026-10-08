'use client';

import { FileText, Film, MapPin, RefreshCw, Undo2 } from 'lucide-react';
import type { EvidenceView } from '@samadhaan/shared';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  EVIDENCE_STATUS_DISPLAY,
  EVIDENCE_TYPE_LABEL,
  formatFileSize,
} from '@/lib/verification';
import { AiVerificationReview } from './ai-verification-review';

/**
 * One evidence item: what was submitted, by whom, its files (opened through
 * the API's access check), the government's reason if it returned it, and the
 * AI review. Files are the raw evidence — the review is about them.
 */
export function EvidenceCard({
  evidence,
  onWithdraw,
  onAnalyze,
}: {
  evidence: EvidenceView;
  onWithdraw?: () => void;
  onAnalyze?: () => void;
}) {
  const status = EVIDENCE_STATUS_DISPLAY[evidence.status];
  const aiRunning = evidence.aiStatus === 'PENDING' || evidence.aiStatus === 'PROCESSING';
  return (
    <article
      className="space-y-3 rounded-card border border-border p-4"
      aria-label={evidence.title}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="type-body-sm font-semibold text-ink">{evidence.title}</h3>
          <p className="type-caption text-ink-subtle">
            {EVIDENCE_TYPE_LABEL[evidence.evidenceType]}
            {evidence.version > 1 ? ` · version ${evidence.version}` : ''} ·{' '}
            {evidence.submittedBy.name}
            {evidence.submittedAt ? (
              <>
                {' · '}
                <time
                  dateTime={evidence.submittedAt}
                  title={formatDateTime(evidence.submittedAt)}
                >
                  {formatRelativeTime(evidence.submittedAt)}
                </time>
              </>
            ) : (
              ' · not yet submitted'
            )}
            {evidence.replacedByEvidenceId ? ' · replaced by a newer version' : ''}
          </p>
        </div>
        <Badge size="sm" tone={status.tone}>
          {status.label}
        </Badge>
      </div>

      {evidence.description && (
        <p className="type-body-sm whitespace-pre-line text-ink-muted">
          {evidence.description}
        </p>
      )}

      {evidence.decisionReason &&
        (evidence.status === 'NEEDS_MORE_EVIDENCE' || evidence.status === 'REJECTED') && (
          <Alert
            tone={evidence.status === 'REJECTED' ? 'danger' : 'warning'}
            title="From the government office"
          >
            {evidence.decisionReason}
          </Alert>
        )}

      {evidence.files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Files">
          {evidence.files.map((file, index) => (
            <li key={file.id} className="min-w-0">
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-control border border-border-subtle hover:border-primary"
              >
                {file.mimeType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authorised API file, not static media
                  <img
                    src={file.url}
                    alt={`${file.role.toLowerCase()} photo ${index + 1}: ${file.fileName}`}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : (
                  <span className="flex aspect-[4/3] flex-col items-center justify-center gap-1 bg-subtle p-2 text-center">
                    {file.mimeType.startsWith('video/') ? (
                      <Film className="size-5 text-ink-subtle" aria-hidden="true" />
                    ) : (
                      <FileText className="size-5 text-ink-subtle" aria-hidden="true" />
                    )}
                    <span className="line-clamp-2 type-caption text-ink">
                      {file.fileName}
                    </span>
                  </span>
                )}
              </a>
              <p className="mt-0.5 truncate type-caption text-ink-subtle">
                F{index + 1} · {file.role.toLowerCase()} · {formatFileSize(file.fileSize)}
              </p>
              {file.locationDistanceM !== null && (
                <p className="inline-flex items-center gap-0.5 type-caption text-ink-subtle">
                  <MapPin className="size-3" aria-hidden="true" />
                  {file.locationDistanceM} m from report (metadata)
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {aiRunning ? (
        <p role="status" className="type-caption font-medium text-ai">
          AI review: processing…
        </p>
      ) : evidence.assessment ? (
        <AiVerificationReview assessment={evidence.assessment} />
      ) : null}

      {(onWithdraw || onAnalyze) && (
        <div className="flex flex-wrap gap-2">
          {onAnalyze && evidence.permissions.canAnalyze && (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<RefreshCw />}
              onClick={onAnalyze}
            >
              Run AI review again
            </Button>
          )}
          {onWithdraw && evidence.permissions.canWithdraw && (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Undo2 />}
              onClick={onWithdraw}
            >
              Withdraw
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
