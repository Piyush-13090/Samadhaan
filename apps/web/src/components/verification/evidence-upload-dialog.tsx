'use client';

import { Camera, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  EVIDENCE_DESCRIPTION_MAX,
  EVIDENCE_DOCUMENT_MAX_BYTES,
  EVIDENCE_FILES_MAX,
  EVIDENCE_IMAGE_MAX_BYTES,
  EVIDENCE_TITLE_MAX,
  EVIDENCE_TYPES,
  EVIDENCE_VIDEO_MAX_BYTES,
  type EvidenceFileRole,
  type EvidenceType,
  type EvidenceView,
} from '@samadhaan/shared';
import { NativeSelect } from '@/components/project/native-select';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import {
  ACCEPTED_EVIDENCE_FILES,
  EVIDENCE_TYPE_LABEL,
  formatFileSize,
} from '@/lib/verification';
import {
  createEvidence,
  removeEvidenceFile,
  submitEvidence,
  uploadEvidenceFile,
} from '@/services/verification.service';

interface Pending {
  key: string;
  file: File;
  role: EvidenceFileRole;
  preview: string | null;
  progress: number;
  state: 'waiting' | 'uploading' | 'done' | 'error';
  error: string | null;
  /** Set once uploaded. */
  fileId: string | null;
}

/** A first, friendly check. The API checks the bytes again and decides. */
export function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const image = /\.(jpe?g|png|webp)$/.test(name);
  const pdf = name.endsWith('.pdf');
  const video = /\.(mp4|mov|m4v)$/.test(name);
  if (!image && !pdf && !video)
    return 'Use a JPEG, PNG or WebP photo, a PDF, or an MP4 video.';
  const max = image
    ? EVIDENCE_IMAGE_MAX_BYTES
    : pdf
      ? EVIDENCE_DOCUMENT_MAX_BYTES
      : EVIDENCE_VIDEO_MAX_BYTES;
  if (file.size > max) return `Larger than ${max / 1024 / 1024} MB.`;
  return null;
}

function defaultRole(file: File, type: EvidenceType): EvidenceFileRole {
  if (file.name.toLowerCase().endsWith('.pdf')) return 'DOCUMENT';
  if (/\.(mp4|mov|m4v)$/i.test(file.name)) return 'OTHER';
  return type === 'BEFORE_AFTER_IMAGE' ||
    type === 'AFTER_IMAGE' ||
    type === 'LOCATION_PROOF'
    ? 'AFTER'
    : 'OTHER';
}

/**
 * Submit completion evidence: describe it, add files (drop, choose, or take a
 * photo on a phone), watch each upload, retry what fails, then submit. The AI
 * review starts in the background after submission.
 */
export function EvidenceUploadDialog({
  projectId,
  open,
  replaces,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  open: boolean;
  /** Evidence this new version replaces. */
  replaces?: EvidenceView | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()}>
      {open && (
        <UploadForm
          projectId={projectId}
          replaces={replaces ?? null}
          onClose={onClose}
          onSubmitted={onSubmitted}
        />
      )}
    </Modal>
  );
}

function UploadForm({
  projectId,
  replaces,
  onClose,
  onSubmitted,
}: {
  projectId: string;
  replaces: EvidenceView | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [type, setType] = useState<EvidenceType>(replaces?.evidenceType ?? 'AFTER_IMAGE');
  const [title, setTitle] = useState(replaces ? `${replaces.title} (updated)` : '');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<Pending[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  // Free preview URLs when the dialog closes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function add(list: FileList | File[] | null) {
    if (!list) return;
    const next: Pending[] = [];
    for (const file of Array.from(list)) {
      if (files.length + next.length >= EVIDENCE_FILES_MAX) {
        setError(`At most ${EVIDENCE_FILES_MAX} files per evidence item.`);
        break;
      }
      const problem = checkFile(file);
      const preview =
        !problem && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      if (preview) previews.current.push(preview);
      next.push({
        key: `${file.name}-${file.size}-${Math.random()}`,
        file,
        role: defaultRole(file, type),
        preview,
        progress: 0,
        state: problem ? 'error' : 'waiting',
        error: problem,
        fileId: null,
      });
    }
    setFiles((current) => [...current, ...next]);
  }

  const update = (key: string, patch: Partial<Pending>) =>
    setFiles((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  async function ensureDraft(): Promise<string> {
    if (draftId) return draftId;
    const created = await createEvidence(projectId, {
      evidenceType: type,
      title: title.trim(),
      description: description.trim() || null,
      ...(replaces ? { replacesEvidenceId: replaces.id } : {}),
    });
    setDraftId(created.id);
    return created.id;
  }

  async function uploadOne(id: string, item: Pending): Promise<boolean> {
    if (checkFile(item.file)) return false;
    update(item.key, { state: 'uploading', progress: 0, error: null });
    try {
      const view = await uploadEvidenceFile(id, item.file, item.role, (p) =>
        update(item.key, { progress: p }),
      );
      const stored = view.files[view.files.length - 1];
      update(item.key, { state: 'done', progress: 1, fileId: stored?.id ?? null });
      return true;
    } catch (caught) {
      update(item.key, {
        state: 'error',
        error: caught instanceof ApiError ? caught.message : 'The upload failed.',
      });
      return false;
    }
  }

  async function submit() {
    if (!title.trim()) return setError('Give the evidence a title.');
    const usable = files.filter((f) => !checkFile(f.file));
    if (usable.length === 0 && !(type === 'PROGRESS_UPDATE' && description.trim())) {
      return setError('Add at least one file.');
    }
    setBusy(true);
    setError(null);
    try {
      const id = await ensureDraft();
      let ok = true;
      for (const item of usable) {
        if (item.state === 'done') continue;
        ok = (await uploadOne(id, item)) && ok;
      }
      if (!ok) {
        setError('Some files did not upload. Retry or remove them, then submit.');
        return;
      }
      await submitEvidence(id);
      onSubmitted();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The evidence could not be submitted.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Pending) {
    if (item.fileId && draftId) {
      try {
        await removeEvidenceFile(draftId, item.fileId);
      } catch {
        return setError('That file could not be removed.');
      }
    }
    setFiles((current) => current.filter((f) => f.key !== item.key));
  }

  return (
    <ModalContent
      size="lg"
      title={replaces ? 'Submit a new version' : 'Submit completion evidence'}
      description="Evidence goes to the government office that allocated this work. An AI review runs in the background; it advises, and the office decides."
      footer={
        <>
          <ModalClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </ModalClose>
          <Button size="sm" loading={busy} onClick={() => void submit()}>
            Upload and submit
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <NativeSelect
              value={type}
              disabled={draftId !== null}
              onChange={(event) => setType(event.target.value as EvidenceType)}
            >
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVIDENCE_TYPE_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Title" required>
            <Input
              value={title}
              maxLength={EVIDENCE_TITLE_MAX}
              disabled={draftId !== null}
              placeholder="e.g. Road surface repaired"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>
        <Field label="What was done" hint="Describe the work and when it was finished.">
          <Textarea
            rows={3}
            value={description}
            maxLength={EVIDENCE_DESCRIPTION_MAX}
            disabled={draftId !== null}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div
          role="group"
          aria-label="Files"
          onDragOver={(event: DragEvent) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            add(event.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-control border-2 border-dashed p-5 text-center',
            dragging ? 'border-primary bg-primary-soft/40' : 'border-border',
          )}
        >
          <Upload className="size-5 text-ink-subtle" aria-hidden="true" />
          <p className="type-body-sm text-ink">Drop photos, a PDF or a video here</p>
          <p className="type-caption text-ink-subtle">
            Photos up to 10 MB, PDFs 10 MB, video 50 MB. Up to {EVIDENCE_FILES_MAX} files.
            Photo location metadata is read to compare with the report, then removed from
            the stored copy.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leadingIcon={<Upload />}
              onClick={() => pick.current?.click()}
            >
              Choose files
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leadingIcon={<Camera />}
              onClick={() => camera.current?.click()}
            >
              Take a photo
            </Button>
          </div>
          <input
            ref={pick}
            type="file"
            multiple
            accept={ACCEPTED_EVIDENCE_FILES}
            className="sr-only"
            aria-label="Choose evidence files"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Take a photo"
            onChange={(event) => {
              add(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-2" aria-label="Selected files">
            {files.map((item) => (
              <li
                key={item.key}
                className="flex items-start gap-3 rounded-control border border-border-subtle p-2"
              >
                {item.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview of a chosen file
                  <img
                    src={item.preview}
                    alt=""
                    className="size-14 shrink-0 rounded-control object-cover"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-control bg-subtle type-caption text-ink-subtle">
                    {item.file.name.split('.').pop()?.toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate type-body-sm text-ink">{item.file.name}</p>
                  <p className="type-caption text-ink-subtle">
                    {formatFileSize(item.file.size)}
                  </p>
                  {item.file.type.startsWith('image/') && (
                    <label className="flex items-center gap-1.5 type-caption text-ink-muted">
                      Shows
                      <select
                        value={item.role}
                        disabled={item.state === 'done' || item.state === 'uploading'}
                        onChange={(event) =>
                          update(item.key, {
                            role: event.target.value as EvidenceFileRole,
                          })
                        }
                        className="rounded border border-border bg-surface px-1 py-0.5 type-caption"
                      >
                        <option value="AFTER">after the work</option>
                        <option value="BEFORE">before the work</option>
                        <option value="OTHER">other</option>
                      </select>
                    </label>
                  )}
                  {item.state === 'uploading' && (
                    <ProgressBar
                      value={Math.round(item.progress * 100)}
                      label={`Uploading ${item.file.name}`}
                      size="sm"
                    />
                  )}
                  {item.state === 'done' && (
                    <p className="type-caption text-success">Uploaded</p>
                  )}
                  {item.error && (
                    <p role="alert" className="type-caption text-danger">
                      {item.error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {item.state === 'error' && !checkFile(item.file) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      iconOnly
                      aria-label={`Retry ${item.file.name}`}
                      onClick={async () => {
                        const id = await ensureDraft().catch(() => null);
                        if (id) await uploadOne(id, item);
                      }}
                    >
                      <RotateCcw />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    iconOnly
                    aria-label={`Remove ${item.file.name}`}
                    disabled={item.state === 'uploading'}
                    onClick={() => void remove(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="type-body-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </ModalContent>
  );
}
