import { isApiSuccess, type ApiResponse } from '@samadhaan/shared';
import { ApiError } from './api-error';

/**
 * The single HTTP client for the Samadhaan API.
 *
 * Every call in the application goes through here, which is what makes the
 * architectural rule enforceable: the browser talks to the NestJS API and to
 * nothing else — never to the Python AI service directly.
 *
 * It unwraps the standard `{ success, data, meta }` envelope so callers work
 * with plain domain objects, and converts any failure into an `ApiError`
 * carrying a stable `code`.
 */

export interface RequestOptions {
  /** Query string parameters; `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Next.js fetch cache control, for server components. */
  cache?: RequestCache;
  revalidate?: number;
  /**
   * Extra headers. Used by server components to forward the incoming request's
   * `cookie` header, since there is no browser cookie jar on the server.
   */
  headers?: Record<string, string>;
}

interface InternalOptions extends RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

/**
 * Builds the request URL.
 *
 * An empty `baseUrl` yields a relative path, which is what the browser uses —
 * same-origin requests proxied to NestJS by `next.config.ts`. Server components
 * pass an absolute base, because there is no origin to be relative to.
 */
function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const pathname = `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }

  const search = params.toString();
  const suffix = search ? `?${search}` : '';

  return baseUrl
    ? new URL(`${pathname}${suffix}`, baseUrl).toString()
    : `${pathname}${suffix}`;
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  get<TData>(path: string, options: RequestOptions = {}): Promise<TData> {
    return this.request<TData>(path, { ...options, method: 'GET' });
  }

  post<TData>(
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<TData> {
    return this.request<TData>(path, { ...options, method: 'POST', body });
  }

  patch<TData>(
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<TData> {
    return this.request<TData>(path, { ...options, method: 'PATCH', body });
  }

  delete<TData>(path: string, options: RequestOptions = {}): Promise<TData> {
    return this.request<TData>(path, { ...options, method: 'DELETE' });
  }

  private async request<TData>(
    path: string,
    { method, body, query, signal, cache, revalidate, headers }: InternalOptions,
  ): Promise<TData> {
    const url = buildUrl(this.baseUrl, path, query);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal,
        cache,
        ...(revalidate === undefined ? {} : { next: { revalidate } }),
        // Sends the httpOnly auth cookies. Required for every authenticated
        // call, and harmless on public ones.
        credentials: 'include',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // fetch only rejects when the request never completed.
      throw ApiError.network(
        error instanceof Error ? error.message : 'Could not reach the Samadhaan API',
      );
    }

    // 204 No Content carries no body — logout is the case in practice. Parsing
    // it as JSON would throw and turn a successful call into an error.
    if (response.status === 204) return undefined as TData;

    let payload: ApiResponse<TData>;
    try {
      payload = (await response.json()) as ApiResponse<TData>;
    } catch {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        message: `The API returned a malformed response (HTTP ${response.status})`,
        status: response.status,
      });
    }

    if (!isApiSuccess(payload)) {
      throw new ApiError({
        code: payload.error.code as ApiError['code'],
        message: payload.error.message,
        status: response.status,
        details: payload.error.details,
        requestId: payload.meta?.requestId,
      });
    }

    return payload.data;
  }
}
