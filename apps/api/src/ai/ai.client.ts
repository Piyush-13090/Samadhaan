import { Injectable, Logger } from '@nestjs/common';
import {
  REQUEST_ID_HEADER,
  err,
  ok,
  toErrorMessage,
  type Result,
} from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';

/**
 * A non-2xx response from the AI service, carrying its body.
 *
 * The body matters: it holds the `code`/`retryable` pair the orchestration
 * layer needs to decide between retrying and giving up.
 */
export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/** Options accepted by a single AI service call. */
export interface AiRequestOptions {
  /** Correlation id to propagate, so one trace spans web -> api -> ai. */
  requestId?: string;
  /** Per-call override of the configured timeout. */
  timeoutMs?: number;
}

/**
 * Transport layer for the Python AI service.
 *
 * This is the ONLY place in the codebase that knows the AI service exists over
 * HTTP. It owns the base URL, the internal auth header, timeouts and error
 * normalisation; `AiService` and future feature modules call it through typed
 * methods and never touch `fetch` themselves.
 *
 * Every method returns a `Result` rather than throwing, because an unreachable
 * AI service is an expected operational state that callers must degrade around.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);

  constructor(private readonly config: AppConfig) {}

  get baseUrl(): string {
    return this.config.aiServiceUrl;
  }

  /** GET a JSON resource from the AI service. */
  async get<TResponse>(
    path: string,
    options: AiRequestOptions = {},
  ): Promise<Result<TResponse>> {
    return this.request<TResponse>('GET', path, undefined, options);
  }

  /** POST a JSON payload to the AI service. */
  async post<TResponse>(
    path: string,
    body: unknown,
    options: AiRequestOptions = {},
  ): Promise<Result<TResponse>> {
    return this.request<TResponse>('POST', path, body, options);
  }

  private async request<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: AiRequestOptions,
  ): Promise<Result<TResponse>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const timeoutMs = options.timeoutMs ?? this.config.aiServiceTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: this.buildHeaders(options.requestId, body !== undefined),
        // Omit the key entirely rather than passing `undefined`: fetch rejects
        // a body on GET even when it is undefined.
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (!response.ok) {
        // The body is parsed rather than stringified, because the AI service
        // returns a structured failure whose `retryable` flag decides whether
        // the caller tries again. Flattening it to a message would cost that.
        const body: unknown = await response.json().catch(() => null);

        return err(
          new AiRequestError(
            `AI service responded ${response.status}`,
            response.status,
            body,
          ),
        );
      }

      return ok((await response.json()) as TResponse);
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? `AI service request timed out after ${timeoutMs}ms`
          : toErrorMessage(error);
      this.logger.warn(`${method} ${url} failed: ${message}`);
      return err(new Error(message));
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(requestId: string | undefined, hasBody: boolean): HeadersInit {
    const headers: Record<string, string> = { accept: 'application/json' };

    if (hasBody) headers['content-type'] = 'application/json';
    if (requestId) headers[REQUEST_ID_HEADER] = requestId;

    const token = this.config.aiServiceToken;
    if (token) headers['x-internal-token'] = token;

    return headers;
  }
}
