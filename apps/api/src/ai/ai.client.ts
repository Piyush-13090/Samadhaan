import { Injectable, Logger } from '@nestjs/common';
import {
  REQUEST_ID_HEADER,
  err,
  ok,
  toErrorMessage,
  type Result,
} from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';

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
        const detail = await response.text().catch(() => '');
        return err(
          new Error(
            `AI service responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
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
