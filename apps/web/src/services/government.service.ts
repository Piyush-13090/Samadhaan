import { cache } from 'react';
import type {
  GovernmentContext,
  GovernmentDashboard,
  GovernmentInternalNote,
  GovernmentProblemDetail,
  GovernmentProblemPage,
  GovernmentWorkspaceSummary,
  ProblemStatus,
  TrendRange,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { toWorkspaceQueryString } from './workspace.service';

/**
 * Government portal calls. Every one is scoped by the office's slug; the API
 * resolves the caller's membership and the office's jurisdiction itself.
 */

function serverOptions(cookieHeader: string) {
  return {
    cache: 'no-store' as const,
    headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
  };
}

const base = (slug: string) => `/government/${encodeURIComponent(slug)}`;

export const fetchGovernmentOfficesOnServer = cache(
  async (cookieHeader: string): Promise<GovernmentWorkspaceSummary[]> => {
    try {
      return await createServerApi().get<GovernmentWorkspaceSummary[]>(
        '/government/mine',
        serverOptions(cookieHeader),
      );
    } catch {
      return [];
    }
  },
);

export type GovernmentResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not-found' }
  | { kind: 'forbidden'; message: string }
  | { kind: 'error'; reference?: string };

async function serverGet<T>(
  path: string,
  cookieHeader: string,
): Promise<GovernmentResult<T>> {
  try {
    return {
      kind: 'ok',
      data: await createServerApi().get<T>(path, serverOptions(cookieHeader)),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'not-found' };
    if (error instanceof ApiError && error.status === 403) {
      return { kind: 'forbidden', message: error.message };
    }
    return {
      kind: 'error',
      reference: error instanceof ApiError ? error.requestId : undefined,
    };
  }
}

/** Shared by the layout and its page within one render. */
export const fetchGovernmentContextOnServer = cache(
  (slug: string, cookieHeader: string) =>
    serverGet<GovernmentContext>(`${base(slug)}/context`, cookieHeader),
);

export function fetchGovernmentDashboardOnServer(
  slug: string,
  range: TrendRange,
  cookieHeader: string,
) {
  return serverGet<GovernmentDashboard>(
    `${base(slug)}/dashboard?range=${range}`,
    cookieHeader,
  );
}

export function fetchGovernmentProblemOnServer(
  slug: string,
  publicId: string,
  cookieHeader: string,
) {
  return serverGet<GovernmentProblemDetail>(
    `${base(slug)}/problems/${encodeURIComponent(publicId)}`,
    cookieHeader,
  );
}

export interface GovernmentProblemsQuery {
  view?: 'queue' | 'all';
  status?: string;
  severity?: string;
  category?: string;
  aiStatus?: string;
  duplicate?: string;
  area?: string;
  q?: string;
  reportedFrom?: string;
  reportedTo?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export function fetchGovernmentProblems(
  slug: string,
  query: GovernmentProblemsQuery,
  signal?: AbortSignal,
): Promise<GovernmentProblemPage> {
  return api.get<GovernmentProblemPage>(
    `${base(slug)}/problems${toWorkspaceQueryString(query as never)}`,
    { cache: 'no-store', signal },
  );
}

export function changeProblemStatus(
  slug: string,
  publicId: string,
  status: ProblemStatus,
  note?: string,
): Promise<{ status: ProblemStatus; allowedTransitions: ProblemStatus[] }> {
  return api.patch(`${base(slug)}/problems/${encodeURIComponent(publicId)}/status`, {
    status,
    ...(note ? { note } : {}),
  });
}

export function addInternalNote(
  slug: string,
  publicId: string,
  body: string,
): Promise<GovernmentInternalNote> {
  return api.post<GovernmentInternalNote>(
    `${base(slug)}/problems/${encodeURIComponent(publicId)}/notes`,
    { body },
  );
}

export function governmentMapSource(slug: string) {
  return { problems: `${base(slug)}/map`, aggregate: `${base(slug)}/map/aggregate` };
}
