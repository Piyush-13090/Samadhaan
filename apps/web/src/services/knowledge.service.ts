import type {
  KnowledgeAnswerView,
  KnowledgeAuthoring,
  KnowledgeChunkView,
  KnowledgeContext,
  KnowledgeSourcePage,
  KnowledgeSourceType,
  KnowledgeSourceView,
  KnowledgeVisibility,
  ProblemCategory,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Knowledge & RAG calls (Prompt 20). Every list, page and answer is filtered
 * by the API to what the signed-in person may see — nothing here decides
 * access.
 */
const source = (id: string) => `/knowledge/sources/${encodeURIComponent(id)}`;

export interface KnowledgeQuestion {
  query: string;
  contextType: KnowledgeContext;
  problemId?: string;
  projectId?: string;
}

export function askKnowledge(input: KnowledgeQuestion): Promise<KnowledgeAnswerView> {
  return api.post<KnowledgeAnswerView>('/knowledge/query', input);
}

export function fetchAuthoring(): Promise<KnowledgeAuthoring> {
  return api.get<KnowledgeAuthoring>('/knowledge/authoring', { cache: 'no-store' });
}

export function fetchSources(
  filters: { page?: number; q?: string; manageable?: boolean; projectId?: string } = {},
): Promise<KnowledgeSourcePage> {
  return api.get<KnowledgeSourcePage>('/knowledge/sources', {
    cache: 'no-store',
    query: {
      page: filters.page,
      q: filters.q || undefined,
      manageable: filters.manageable || undefined,
      projectId: filters.projectId,
    },
  });
}

export type SourceResult =
  | { kind: 'ok'; source: KnowledgeSourceView }
  | { kind: 'not-found' }
  | { kind: 'error'; reference?: string };

/** Server-side. A source the viewer may not read is reported as not found. */
export async function fetchSourceOnServer(
  id: string,
  cookieHeader: string,
): Promise<SourceResult> {
  try {
    const found = await createServerApi().get<KnowledgeSourceView>(source(id), {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
    });
    return { kind: 'ok', source: found };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return { kind: 'not-found' };
    }
    return {
      kind: 'error',
      reference: error instanceof ApiError ? error.requestId : undefined,
    };
  }
}

export function fetchSource(id: string): Promise<KnowledgeSourceView> {
  return api.get<KnowledgeSourceView>(source(id), { cache: 'no-store' });
}

export function fetchChunks(id: string): Promise<KnowledgeChunkView[]> {
  return api.get<KnowledgeChunkView[]>(`${source(id)}/chunks`, { cache: 'no-store' });
}

export interface SourceInput {
  title: string;
  description?: string | null;
  sourceType: KnowledgeSourceType;
  visibility: KnowledgeVisibility;
  organizationId?: string;
  projectId?: string;
  externalUrl?: string | null;
  content?: string | null;
  categories?: ProblemCategory[];
  city?: string | null;
}

export function createSource(input: SourceInput): Promise<KnowledgeSourceView> {
  return api.post<KnowledgeSourceView>('/knowledge/sources', input);
}

export function updateSource(
  id: string,
  input: Partial<Omit<SourceInput, 'visibility' | 'organizationId' | 'projectId'>>,
): Promise<KnowledgeSourceView> {
  return api.patch<KnowledgeSourceView>(source(id), input);
}

export function deleteSource(id: string): Promise<void> {
  return api.delete<void>(source(id));
}

export function reindexSource(id: string): Promise<KnowledgeSourceView> {
  return api.post<KnowledgeSourceView>(`${source(id)}/ingest`);
}

/** Multipart, so not through the JSON client. Same envelope on the way back. */
export async function uploadSourceFile(
  id: string,
  file: File,
): Promise<KnowledgeSourceView> {
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetch(`/api/v1${source(id)}/file`, {
      method: 'POST',
      body,
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw ApiError.network('Could not reach Samadhaan. Check your connection.');
  }
  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: KnowledgeSourceView }
    | { success: false; error: { code: string; message: string } }
    | null;
  if (!payload || !payload.success) {
    throw new ApiError({
      code: (payload && !payload.success
        ? payload.error.code
        : 'INTERNAL_ERROR') as ApiError['code'],
      message:
        payload && !payload.success
          ? payload.error.message
          : 'The upload failed. Please try again.',
      status: response.status,
    });
  }
  return payload.data;
}
