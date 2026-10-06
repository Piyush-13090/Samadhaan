import type {
  KnowledgeIngestionStatus,
  KnowledgeSourceType,
  KnowledgeVisibility,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

export const SOURCE_TYPE_LABEL: Record<KnowledgeSourceType, string> = {
  CIVIC_GUIDELINE: 'Civic guideline',
  GOVERNMENT_POLICY: 'Government policy',
  PROJECT_DOCUMENT: 'Project document',
  PROJECT_NOTE: 'Project note',
  PROBLEM_CONTEXT: 'Problem context',
  ORGANIZATION_DOCUMENT: 'Organisation document',
  WEB_REFERENCE: 'Web reference',
  OTHER: 'Other',
};

/** Who can read a source — stated plainly wherever a source is shown. */
export const VISIBILITY_DISPLAY: Record<
  KnowledgeVisibility,
  { label: string; description: string }
> = {
  PUBLIC: { label: 'Public', description: 'Anyone signed in to Samadhaan.' },
  GOVERNMENT: {
    label: 'Government office',
    description: 'Officials of the owning government office only.',
  },
  ORGANIZATION: {
    label: 'Organisation',
    description: 'Active members of the owning organisation only.',
  },
  PROJECT: {
    label: 'Project',
    description: 'Participants of one resolution project, inside that project only.',
  },
  PRIVATE: { label: 'Private', description: 'Only you.' },
};

export const STATUS_DISPLAY: Record<
  KnowledgeIngestionStatus,
  { label: string; tone: Tone }
> = {
  PENDING: { label: 'Queued', tone: 'neutral' },
  PROCESSING: { label: 'Indexing', tone: 'info' },
  COMPLETED: { label: 'Indexed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
