import type {
  DuplicateCheckView,
  CreateProblemInput,
  ProblemAnalysisView,
  ProblemView,
  UploadedImage,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Problem reporting and retrieval.
 *
 * Uploads go through `fetch` directly rather than the shared `ApiClient`,
 * because the client sets `content-type: application/json` and a multipart body
 * must let the browser set its own boundary. Everything else — the envelope,
 * the error mapping, same-origin cookies — is handled the same way.
 */

/**
 * Uploads one image, reporting progress.
 *
 * `XMLHttpRequest` rather than `fetch`: upload progress events are still not
 * available on `fetch` in browsers, and a citizen on a phone connection sending
 * an 8 MB photo needs to see that something is happening.
 */
export function uploadProblemImage(
  file: File,
  options: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('file', file);

    const request = new XMLHttpRequest();
    request.open('POST', '/api/v1/problems/images');
    request.withCredentials = true;

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener('load', () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(
          new ApiError({
            code: 'INTERNAL_ERROR',
            message: 'The upload failed. Please try again.',
            status: request.status,
          }),
        );
        return;
      }

      const envelope = payload as
        | { success: true; data: UploadedImage }
        | { success: false; error: { code: string; message: string } };

      if (request.status >= 200 && request.status < 300 && envelope.success) {
        resolve(envelope.data);
        return;
      }

      reject(
        new ApiError({
          code: (envelope.success === false
            ? envelope.error.code
            : 'INTERNAL_ERROR') as ApiError['code'],
          message:
            envelope.success === false
              ? envelope.error.message
              : 'The upload failed. Please try again.',
          status: request.status,
        }),
      );
    });

    request.addEventListener('error', () =>
      reject(ApiError.network('Could not reach Samadhaan. Check your connection.')),
    );

    request.addEventListener('abort', () =>
      reject(ApiError.network('Upload cancelled.')),
    );

    options.signal?.addEventListener('abort', () => request.abort());

    request.send(body);
  });
}

export function createProblem(input: CreateProblemInput): Promise<ProblemView> {
  return api.post<ProblemView>('/problems', input);
}

/**
 * A problem by public id, during server rendering.
 *
 * Returns `null` for an unknown id so the page can render `notFound()` rather
 * than a crash.
 */
export async function fetchProblemOnServer(
  publicId: string,
  cookieHeader: string,
): Promise<ProblemView | null> {
  try {
    return await createServerApi().get<ProblemView>(
      `/problems/${encodeURIComponent(publicId)}`,
      {
        cache: 'no-store',
        headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
      },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

// --- AI analysis -----------------------------------------------------------

/** The latest analysis for a problem, or `null` when none has been run. */
export function fetchAnalysis(publicId: string): Promise<ProblemAnalysisView | null> {
  return api.get<ProblemAnalysisView | null>(
    `/problems/${encodeURIComponent(publicId)}/analysis`,
    { cache: 'no-store' },
  );
}

/** Re-runs analysis. Only the reporter and admins are permitted. */
export function retryAnalysis(publicId: string): Promise<ProblemAnalysisView> {
  return api.post<ProblemAnalysisView>(
    `/problems/${encodeURIComponent(publicId)}/analyze`,
  );
}

/** The analysis resolved during server rendering, for the detail page. */
export async function fetchAnalysisOnServer(
  publicId: string,
  cookieHeader: string,
): Promise<ProblemAnalysisView | null> {
  try {
    return await createServerApi().get<ProblemAnalysisView | null>(
      `/problems/${encodeURIComponent(publicId)}/analysis`,
      {
        cache: 'no-store',
        headers: cookieHeader
          ? { cookie: cookieHeader }
          : ({} as Record<string, string>),
      },
    );
  } catch (error) {
    // A missing analysis is a normal state, not a page failure.
    if (error instanceof ApiError) return null;
    throw error;
  }
}

// --- Duplicate detection ---------------------------------------------------

/** Problems that may already describe the same issue. */
export function fetchSimilar(publicId: string): Promise<DuplicateCheckView> {
  return api.get<DuplicateCheckView>(
    `/problems/${encodeURIComponent(publicId)}/similar`,
    { cache: 'no-store' },
  );
}

/**
 * Records that this report describes the same issue as an existing one.
 *
 * Only the pair id is sent. Scores are generated server-side and the API
 * ignores — in fact rejects — any the client tries to supply.
 */
export function confirmDuplicate(
  publicId: string,
  candidateId: string,
): Promise<DuplicateCheckView> {
  return api.post<DuplicateCheckView>(
    `/problems/${encodeURIComponent(publicId)}/duplicates/${encodeURIComponent(candidateId)}/confirm`,
  );
}

/** Records that this report is a different issue from the suggested one. */
export function rejectDuplicate(
  publicId: string,
  candidateId: string,
): Promise<DuplicateCheckView> {
  return api.post<DuplicateCheckView>(
    `/problems/${encodeURIComponent(publicId)}/duplicates/${encodeURIComponent(candidateId)}/reject`,
  );
}

/** The duplicate check resolved during server rendering, for the detail page. */
export async function fetchSimilarOnServer(
  publicId: string,
  cookieHeader: string,
): Promise<DuplicateCheckView | null> {
  try {
    return await createServerApi().get<DuplicateCheckView>(
      `/problems/${encodeURIComponent(publicId)}/similar`,
      {
        cache: 'no-store',
        headers: cookieHeader
          ? { cookie: cookieHeader }
          : ({} as Record<string, string>),
      },
    );
  } catch (error) {
    // A missing check is a normal state, not a page failure.
    if (error instanceof ApiError) return null;
    throw error;
  }
}
