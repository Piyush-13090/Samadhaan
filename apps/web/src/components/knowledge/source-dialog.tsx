'use client';

import { useState } from 'react';
import {
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_TITLE_MAX,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  PROBLEM_CATEGORIES,
  type KnowledgeAuthoring,
  type KnowledgeSourceType,
  type KnowledgeSourceView,
  type KnowledgeVisibility,
  type ProblemCategory,
} from '@samadhaan/shared';
import { NativeSelect } from '@/components/project/native-select';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalContent } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-error';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { SOURCE_TYPE_LABEL, VISIBILITY_DISPLAY } from '@/lib/knowledge';
import { createSource, uploadSourceFile } from '@/services/knowledge.service';

const ACCEPT = '.pdf,.txt,.md,.markdown,.html,.htm';

/**
 * Add a knowledge source. The scopes offered are the ones the API says this
 * person may publish to (`/knowledge/authoring`) — and the API checks again.
 * Content is pasted text or one file; indexing runs in the background.
 */
export function SourceDialog({
  open,
  authoring,
  onClose,
  onCreated,
}: {
  open: boolean;
  authoring: KnowledgeAuthoring | null;
  onClose: () => void;
  onCreated: (source: KnowledgeSourceView) => void;
}) {
  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()}>
      {open && authoring && (
        <SourceForm authoring={authoring} onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  );
}

function SourceForm({
  authoring,
  onClose,
  onCreated,
}: {
  authoring: KnowledgeAuthoring;
  onClose: () => void;
  onCreated: (source: KnowledgeSourceView) => void;
}) {
  const scopes = authoring.visibilities;
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(
    scopes[0]?.visibility ?? 'PRIVATE',
  );
  const scope = scopes.find((s) => s.visibility === visibility);
  const [organizationId, setOrganizationId] = useState(scope?.organizations[0]?.id ?? '');
  const [projectId, setProjectId] = useState(scope?.projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>('CIVIC_GUIDELINE');
  const [category, setCategory] = useState<ProblemCategory | ''>('');
  const [city, setCity] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function chooseVisibility(next: KnowledgeVisibility) {
    setVisibility(next);
    const nextScope = scopes.find((s) => s.visibility === next);
    setOrganizationId(nextScope?.organizations[0]?.id ?? '');
    setProjectId(nextScope?.projects[0]?.id ?? '');
  }

  async function submit() {
    if (!title.trim()) return setError('Give the source a title.');
    if (!content.trim() && !file) return setError('Paste the text or choose a file.');
    if (file && file.size > KNOWLEDGE_UPLOAD_MAX_BYTES) {
      return setError('Files can be at most 10 MB.');
    }
    setPending(true);
    setError(null);
    try {
      let created = await createSource({
        title: title.trim(),
        description: description.trim() || null,
        sourceType,
        visibility,
        ...(scope?.organizations.length ? { organizationId } : {}),
        ...(visibility === 'PROJECT' ? { projectId } : {}),
        externalUrl: externalUrl.trim() || null,
        content: file ? null : content,
        categories: category ? [category] : [],
        city: city.trim() || null,
      });
      if (file) created = await uploadSourceFile(created.id, file);
      onCreated(created);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add the source.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalContent
      size="lg"
      title="Add knowledge"
      description="Indexed in the background. Retrieved text is shown as evidence, never treated as instructions."
      footer={
        <>
          <ModalClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </ModalClose>
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() => void submit()}
          >
            Add and index
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
        <Field label="Title" required>
          <Input
            value={title}
            maxLength={KNOWLEDGE_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Who can read it"
            hint={VISIBILITY_DISPLAY[visibility].description}
          >
            <NativeSelect
              value={visibility}
              onChange={(event) =>
                chooseVisibility(event.target.value as KnowledgeVisibility)
              }
            >
              {scopes.map((s) => (
                <option key={s.visibility} value={s.visibility}>
                  {VISIBILITY_DISPLAY[s.visibility].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Type">
            <NativeSelect
              value={sourceType}
              onChange={(event) =>
                setSourceType(event.target.value as KnowledgeSourceType)
              }
            >
              {KNOWLEDGE_SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SOURCE_TYPE_LABEL[type]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {scope && scope.organizations.length > 0 && (
            <Field
              label={visibility === 'GOVERNMENT' ? 'Office' : 'Organisation'}
              hint={
                visibility === 'PUBLIC'
                  ? 'Published on behalf of this office.'
                  : undefined
              }
            >
              <NativeSelect
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                {scope.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {visibility === 'PROJECT' && scope && (
            <Field label="Project">
              <NativeSelect
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {scope.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Category" hint="Ranks this higher for problems of that kind.">
            <NativeSelect
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as ProblemCategory | '')
              }
            >
              <option value="">Any category</option>
              {PROBLEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_DISPLAY[c].label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="City">
            <Input
              value={city}
              maxLength={100}
              onChange={(event) => setCity(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Description">
          <Input
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field
          label="Original link"
          hint="Recorded as a reference only — Samadhaan does not fetch it."
        >
          <Input
            type="url"
            value={externalUrl}
            placeholder="https://"
            onChange={(event) => setExternalUrl(event.target.value)}
          />
        </Field>
        <Field label="File" hint="PDF, plain text, Markdown or HTML, up to 10 MB.">
          <input
            type="file"
            accept={ACCEPT}
            className="type-body-sm text-ink file:mr-3 file:rounded-control file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:type-body-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        {!file && (
          <Field label="Or paste the text" hint="Markdown headings become sections.">
            <Textarea
              rows={8}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
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
